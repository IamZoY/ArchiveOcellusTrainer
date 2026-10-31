import { CacheRenderModel, CacheRenderReferences, CollisionType, InvisibleMovementBlocker, Mob } from "osrs-sdk";
import type { Model, Projectile, Region, UnitBonuses } from "osrs-sdk";
import type { DamageRange, DrillConfig } from "../OcellusTimings";
import { OCELLUS_P4 } from "../OcellusTimings";
import { bossBonuses, withDefenceFloor } from "../bossStats";
import type { Cycle, Tick, Tile } from "../../../../sim/brands";
import { after, span, tick } from "../../../../sim/brands";
import type { IncomingStyle, Style } from "../../../../sim/combat";
import type { Frame } from "../../../../sim/frame";
import { toRoom, toRoomFootprint } from "../../../../sim/frame";
import { cutAttackDelay } from "../../../../sim/combat";
import type { AttackDelayCut, FrameOf, Heal, HitRequest, Hooks, InFlight, IncomingHit, Judgement, Landed, Logged } from "../../../../sim/sdk/EncounterBinding";
import { incomingStyle } from "../../../../sim/sdk/EncounterBinding";
import type { EncounterBinding } from "../../../../sim/sdk/EncounterBinding";
import type { EncounterPlayer } from "../../../../sim/sdk/EncounterPlayer";
import type {
  Beat,
  BossState,
  FightEvent,
  HealCause,
  InputObservation,
  LingeringVoid,
  Ordinal,
  Phase,
  PlayerHit,
  PlayerObservation,
  RiftId,
  RunEnd,
  RunState,
  Special,
  SpecialAttack,
  TickRow,
  VoidKind,
} from "../P4Types";
import { riftId } from "../P4Types";
import { drawHealSplats, drawOverheadIcon } from "../entities/P4Views";
import type { P4Schedule } from "../p4/schedule";
import type { Moment } from "../../../../sim/schedule";
import { TileSet } from "../../../../sim/tiles";
import type { ExplosionStep, Marks, Reduction } from "../p4/explosions";
import { damageReduction, explode, explosionHit, NO_MARKS } from "../p4/explosions";
import { floorRule, FOOTPRINT, VOID_MASKS } from "../p4/floor";
import type { Orbs, OrbStep } from "../p4/orb";
import { drain, expireOrb, forgiveOrbDebt, formOrb, matureOrb, moveOver, NO_ORBS, releaseUnclaimedOuterOrb, returnDueOrbs } from "../p4/orb";
import { rollInt } from "../roll";
import { compileSchedule } from "../p4/schedule";
import { riftTiles } from "../p4/rifts";
import { VoidRift } from "./VoidRift";

type BossStep = Readonly<{ player: PlayerObservation; bossHp: number; rifts: readonly Rift[] }>;

type P4Run = Readonly<{ input: InputObservation; event: FightEvent; cause: PlayerHit; snapshot: BossStep; row: TickRow; end: RunEnd }>;

type OcellusBinding = EncounterBinding<P4Run>;
export type BindP4 = (start: Tick, hooks: Hooks<P4Run>) => OcellusBinding;

type Output = Logged<FightEvent> | HitRequest<PlayerHit>;
type TurnOutput = Output | AttackDelayCut;

type PlayerAtTurn = PlayerObservation & Readonly<{ attackDelay: number }>;

type Verdict = Reduction | Readonly<{ outcome: "invulnerable" }> | Readonly<{ outcome: "blocked"; style: Style; reflectPercent: number }>;

type Rift = Readonly<{ id: RiftId; tile: Tile; forCycle: Cycle; mob: VoidRift; hpAtPostTick: number; spawnedAt: Tick }>;

/** The SDK keeps a delay-1 hitsplat drawn for the tick it lands and the next. */
const HEAL_SPLAT_TICKS = span(1);

function logs(...events: readonly (FightEvent | null)[]): readonly Logged<FightEvent>[] {
  return events.flatMap((event) => (event === null ? [] : [{ kind: "event", event }]));
}

function fixedHit(amount: number, cause: PlayerHit): HitRequest<PlayerHit> {
  return { kind: "hit", damage: { kind: "fixed", amount }, cause };
}

function phaseEvents(last: Phase | null, now: Phase, at: Tick): FightEvent[] {
  const events: FightEvent[] = [];
  if (last?.stage !== now.stage) events.push({ kind: "stage-entered", at, stage: now.stage });
  if ((last?.overhead ?? null) !== now.overhead) events.push({ kind: "overhead-switched", at, overhead: now.overhead });
  if (last?.boss !== now.boss) events.push({ kind: "boss-state-changed", at, state: now.boss });
  return events;
}

function landedDamage(verdict: Verdict, hit: IncomingHit): number {
  switch (verdict.outcome) {
    case "passed":
      return hit.requested;
    case "invulnerable":
    case "blocked":
      return 0;
    case "reduced":
      return Math.min(hit.requested, Math.floor((hit.rolled * (100 - verdict.percentLess)) / 100));
    default: {
      const unhandled: never = verdict;
      return unhandled;
    }
  }
}

function damageable(state: BossState): boolean {
  switch (state) {
    case "hidden":
      return false;
    case "present-out-of-melee-reach":
    case "present-damageable":
      return true;
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

function specialAttack<V extends Special>(at: Tick, ordinal: Ordinal, variant: V): SpecialAttack<V> {
  return { at, ordinal, variant, style: OCELLUS_P4.special.styles[variant].value };
}

export class Ocellus extends Mob {
  override get demonbaneMultiplier(): number {
    return OCELLUS_P4.boss.demonbaneMultiplier.value;
  }

  private readonly schedule: P4Schedule;
  readonly holes: TileSet;
  readonly binding: OcellusBinding;
  private orbs: Orbs = NO_ORBS;
  private marks: Marks = NO_MARKS;
  private stolen: readonly Readonly<{ ordinal: Ordinal; credit: number }>[] = [];
  private rifts: readonly Rift[] = [];
  private healSplats: readonly Readonly<{ amount: number; lastShown: Tick }>[] = [];

  private readonly hooks: Hooks<P4Run> = {
    "tick-opened": ({ time }) => {
      this.healSplats = this.healSplats.filter((splat) => splat.lastShown >= time.encounter);
    },
    "before-npc-hits": ({ time, incoming }) => ({
      snapshot: { player: this.target.observe(), bossHp: this.currentStats.hitpoint, rifts: this.rifts },
      outputs: incoming.flatMap((landing) => this.judgeIncoming(landing, time.encounter)),
    }),
    "npc-turn": ({ time, snapshot, player }) => this.turn(time.encounter, { ...snapshot.player, attackDelay: player.attackDelay }),
    "hit-applied": ({ hit }) => this.landed(hit),
    "player-hits-settled": ({ time, landed, player }) => this.settlePlayerHits(time.encounter, landed, player),
    "player-moved": ({ time, steps, at }) => {
      this.orbs = moveOver(this.orbs, steps, at, time.encounter, this.config.choices.orbPickupRadius.option.value);
    },
    "tick-ended": (frame) => this.closeRow(frame),
  };

  constructor(
    region: Region,
    private readonly config: DrillConfig,
    private readonly target: EncounterPlayer,
    private readonly invincible: () => boolean,
    bind: BindP4,
    private readonly frame: Frame,
    private readonly voids: readonly LingeringVoid[],
  ) {
    super(region, toRoomFootprint(frame, OCELLUS_P4.geometry.bossAnchor.value, OCELLUS_P4.boss.size.value));
    this.schedule = compileSchedule(config.seed, config.choices);
    this.holes = TileSet.at(this.schedule.acts("floor-holes") ? config.choices.floorHoleLayout.option.value.tiles : []);
    this.binding = bind(this.schedule.start, this.hooks);
  }

  enterP4(): void {
    const maxHp = this.config.choices.bossMaxHp.option.value;
    this.stats = { ...OCELLUS_P4.boss.stats.value, hitpoint: maxHp };
    const lowestDefence = Math.ceil((this.stats.defence * OCELLUS_P4.boss.lowestDefencePercent.value) / 100);
    const entryHp = this.config.bossEntryHp ?? Math.floor(maxHp * this.config.choices.entryHpFraction.option.value);
    this.currentStats = withDefenceFloor({ ...this.stats, hitpoint: entryHp }, lowestDefence);
  }

  /** Phase 3's Defence drains carry into P4 through the same floor a drain in P4 meets. */
  drainDefenceTo(defence: number): void {
    this.currentStats.defence = defence;
  }

  override mobName(): string {
    return "Ocellus";
  }

  override get combatLevel(): number {
    return OCELLUS_P4.boss.combatLevel.value;
  }

  override get size(): number {
    return OCELLUS_P4.boss.size.value;
  }

  override get bonuses(): UnitBonuses {
    return bossBonuses();
  }

  override get deathAnimationLength(): number {
    return OCELLUS_P4.presentation.deathLasts.value;
  }

  override create3dModel(): Model {
    return CacheRenderModel.forRenderable(this, CacheRenderReferences.npc(OCELLUS_P4.boss.npcId.value));
  }

  override visible(): boolean {
    return super.visible() && this.phase().boss !== "hidden";
  }

  override canBeAttacked(): boolean {
    return this.phase().boss !== "hidden";
  }

  outOfMeleeReach(): boolean {
    return this.phase().boss === "present-out-of-melee-reach";
  }

  /** Blocking a player already under him would block every tile around that player, and the SDK finds no path out. */
  blocksMovement(): boolean {
    return OCELLUS_P4.boss.footprint.value[this.phase().stage] === "blocks-movement" && !FOOTPRINT.contains(this.target.observe().tile);
  }

  override get idlePoseId(): number {
    const { deflectLoop, idle } = OCELLUS_P4.presentation.bossPoses;
    return this.phase().stage === "inner-void" ? deflectLoop.value : idle.value;
  }

  override drawOverheadPrayers(context: OffscreenCanvasRenderingContext2D, scale: number): void {
    const { overhead } = this.phase();
    if (overhead !== null) drawOverheadIcon(context, scale, overhead);
  }

  override drawHitsplats(context: OffscreenCanvasRenderingContext2D, scale: number, verticalOffset = 0): void {
    super.drawHitsplats(context, scale, verticalOffset);
    drawHealSplats(context, this.healHitsplatImage, this.healSplats, verticalOffset);
  }

  override movementStep(): void {}

  override attackIfPossible(): void {}

  override addProjectile(projectile: Projectile): void {
    super.addProjectile(projectile);
    this.binding.received(projectile);
  }

  override queueStep(): void {
    this.binding.npcTurn(this, () => super.queueStep());
  }

  runState(): RunState {
    const run = this.binding.view();
    switch (run.kind) {
      case "waiting":
        return { kind: "waiting" };
      case "running":
        return { kind: "running", tick: run.at, phase: this.schedule.at(run.at).phase };
      case "ended":
        return { kind: "ended", at: run.at, reason: run.reason };
      default: {
        const unhandled: never = run;
        return unhandled;
      }
    }
  }

  /** The schedule's next `ticks` moments after `from`, as it will run them: what the mechanics guide counts down to. */
  upcoming(from: Tick, ticks: number): readonly Moment<Phase, Beat>[] {
    return Array.from({ length: ticks }, (_, i) => this.schedule.at(tick(from + i + 1)));
  }

  private phase(): Phase {
    return this.schedule.at(this.binding.view().at).phase;
  }

  private turn(at: Tick, player: PlayerAtTurn): Readonly<{ outputs: readonly TurnOutput[]; ending: RunEnd | null }> {
    const moment = this.schedule.at(at);
    const phased = logs(...phaseEvents(at > 0 ? this.schedule.at(tick(at - 1)).phase : null, moment.phase, at));
    if (this.currentStats.hitpoint <= 0) return { outputs: [...phased, ...logs({ kind: "run-ended", at, reason: "kill" })], ending: "kill" };
    const destroyed = this.destroyFallenRifts(at, player.attackDelay);
    this.rifts.forEach((rift) => rift.mob.charge(span(at - rift.spawnedAt)));
    const reactions = moment.beats.flatMap((beat) => this.react(beat, at, player));
    return { outputs: [...phased, ...destroyed, ...reactions, ...this.strikeHole(at, player), ...this.strikeVoid(at, player)], ending: null };
  }

  landingDamage(projectile: InFlight): number {
    const { hit, at } = this.binding.landing(projectile);
    return landedDamage(this.judge(at, hit.style, hit.launchedAt), hit);
  }

  private judgeIncoming(landing: IncomingHit, at: Tick): readonly (Output | Judgement)[] {
    const verdict = this.judge(at, landing.style, landing.launchedAt);
    const judged: Judgement = { kind: "judge-incoming", hit: landing, damage: landedDamage(verdict, landing) };
    const reflected = verdict.outcome === "blocked" ? this.reflect(verdict, landing.requested, at) : [];
    return [judged, ...reflected, ...logs({ kind: "player-hit-judged", at, style: landing.style, outcome: verdict.outcome, requested: landing.requested })];
  }

  private judge(at: Tick, style: IncomingStyle, launchedAt: Tick): Verdict {
    if (!damageable(this.schedule.at(at).phase.boss)) return { outcome: "invulnerable" };
    const unblocked = damageReduction(this.config.choices, this.schedule.at(at).beats);
    const rule = this.config.choices.deflect.option.value;
    switch (rule.kind) {
      case "none":
        return unblocked;
      case "block": {
        const { overhead } = this.schedule.at(launchedAt).phase;
        const deflected = overhead === null ? null : OCELLUS_P4.deflects[overhead].value;
        return deflected !== null && deflected === style ? { outcome: "blocked", style: deflected, reflectPercent: rule.reflectPercent } : unblocked;
      }
      default: {
        const unhandled: never = rule;
        return unhandled;
      }
    }
  }

  private reflect({ style, reflectPercent }: Extract<Verdict, { outcome: "blocked" }>, blocked: number, at: Tick): readonly Output[] {
    const requested = Math.floor((blocked * reflectPercent) / 100);
    return requested === 0 ? [] : [fixedHit(requested, { kind: "deflect-reflected", at, style })];
  }

  private react(beat: Beat, at: Tick, player: PlayerAtTurn): readonly TurnOutput[] {
    switch (beat.kind) {
      case "boss-shouts":
        this.setOverheadText(beat.text);
        this.overheadTextTimer = beat.lasts;
        return logs({ kind: "boss-shouted", at, text: beat.text });
      case "boss-landing-starts":
        return logs({ kind: "boss-landing-started", at });
      case "floor-damage":
        return this.strikeFloor(beat.void, at, player);
      case "lifeforce-tell":
        return logs({ kind: "lifeforce-told", at, void: beat.void });
      case "lifeforce-hit":
        return [drain({ ...this.config, holes: this.holes }, this.orbs, beat.void, at, player.tile)];
      case "orb-matures":
        return logs(...this.stepOrbs(matureOrb(this.orbs, beat.void, at, player.tile, this.config.choices.orbPickupRadius.option.value)));
      case "orb-expires":
        return logs(...this.stepOrbs(expireOrb(this.orbs, beat.void, at)));
      case "unclaimed-orb-heals":
        return logs(...this.stepOrbs(releaseUnclaimedOuterOrb(this.orbs)).map(({ amount }) => this.healBoss({ kind: "unclaimed-orb" }, amount, at)));
      case "explosion-series-starts":
      case "explosion-mark":
      case "explosion-impact":
      case "explosions-occurring":
        return this.stepMarks(explode(this.config, this.marks, beat, at, player));
      case "special-tell":
        return logs({ kind: "special-told", ...specialAttack(at, beat.ordinal, beat.variant) });
      case "special-hit":
        return [this.strikeSpecial(beat.ordinal, beat.variant, at)];
      case "special-sound":
        return logs({ kind: "special-sounded", at, ordinal: beat.ordinal, cue: beat.cue });
      case "soul-split-heal":
        return logs(this.soulSplit(beat.ordinal, at));
      case "rifts-spawn":
        return logs(...this.spawnRifts(beat.forCycle, at));
      case "rift-charge-ends":
        return this.burstRifts(beat.forCycle, at);
      default: {
        const unhandled: never = beat;
        return unhandled;
      }
    }
  }

  private strikeFloor(kind: VoidKind, at: Tick, player: PlayerObservation): readonly Output[] {
    const rule = floorRule(kind, this.config.choices);
    if (rule.kind === "harmless" || !VOID_MASKS[kind].contains(player.tile)) return [];
    return [fixedHit(rollInt(this.config.seed, "floorDamage", at, rule.perTick, 0), { kind: "floor-hit", at, void: kind, tile: player.tile })];
  }

  private strikeHole(at: Tick, player: PlayerObservation): readonly Output[] {
    const rule = this.config.choices.floorHoleDamage.option.value;
    if (rule.kind === "harmless" || !this.holes.contains(player.tile)) return [];
    return [fixedHit(rollInt(this.config.seed, "holeDamage", at, rule.perTick, 0), { kind: "hole-hit", at, tile: player.tile })];
  }

  private strikeVoid(at: Tick, player: PlayerObservation): readonly Output[] {
    const under = this.voids.find(({ tile, sincePlaced, period }) => tile.x === player.tile.x && tile.y === player.tile.y && (sincePlaced + at) % period === 0);
    return under ? [fixedHit(rollInt(this.config.seed, "voidDamage", at, under.damage, 0), { kind: "void-hit", at, tile: player.tile })] : [];
  }

  private strikeSpecial(ordinal: Ordinal, variant: Special, at: Tick): HitRequest<PlayerHit> {
    const { protectedDamage, unprotectedDamage } = OCELLUS_P4.special;
    const special = specialAttack(at, ordinal, variant);
    const roll = (range: DamageRange) => rollInt(this.config.seed, "specialDamage", at, range, 0);
    return {
      kind: "hit",
      damage: { kind: "by-prayer", style: special.style, protectedAmount: roll(protectedDamage.value), unprotectedAmount: roll(unprotectedDamage.value) },
      cause: { kind: "special-hit", ...special },
    };
  }

  private soulSplit(ordinal: Ordinal, at: Tick): FightEvent | null {
    const stolen = this.stolen.find((theft) => theft.ordinal === ordinal);
    if (!stolen) return null;
    this.stolen = this.stolen.filter((theft) => theft !== stolen);
    return this.healBoss({ kind: "soul-split", ordinal }, stolen.credit, at);
  }

  private spawnRifts(forCycle: Cycle, at: Tick): FightEvent[] {
    return riftTiles(this.config.seed, forCycle, at, this.holes).map((place, slot): FightEvent => {
      const mob = new VoidRift(this.region, toRoom(this.frame, place));
      this.region.addMob(mob);
      const id = riftId(at, slot);
      this.rifts = [...this.rifts, { id, tile: place, forCycle, mob, hpAtPostTick: mob.currentStats.hitpoint, spawnedAt: at }];
      return { kind: "rift-spawned", at, rift: id, tile: place };
    });
  }

  /** A destroyed rift empowers the player, resetting the attack delay (`OCELLUS_P4.rifts.killEmpowers`). */
  private destroyFallenRifts(at: Tick, attackDelay: number): readonly TurnOutput[] {
    const fallen = this.rifts.filter((rift) => rift.hpAtPostTick <= 0);
    this.rifts = this.rifts.filter((rift) => rift.hpAtPostTick > 0);
    if (fallen.length === 0) return [];
    const reset = span(Math.max(0, attackDelay));
    const change = { before: attackDelay, after: cutAttackDelay(attackDelay, reset) };
    return [{ kind: "cut-attack-delay", by: reset }, ...logs(...fallen.map((rift): FightEvent => ({ kind: "rift-destroyed", at, rift: rift.id, tile: rift.tile, attackDelay: change })))];
  }

  /** Every rift due bursts, and together they hit the player once. */
  private burstRifts(forCycle: Cycle, at: Tick): readonly Output[] {
    const isDue = (rift: Rift) => rift.forCycle === forCycle;
    const due = this.rifts.filter(isDue);
    this.rifts = this.rifts.filter((rift) => !isDue(rift));
    if (due.length === 0) return [];
    const [first, ...rest] = due;
    due.forEach((rift) => rift.mob.detonate());
    return [fixedHit(rollInt(this.config.seed, "riftBurst", at, OCELLUS_P4.rifts.burstDamage.value, 0), { kind: "rift-burst", at, rifts: [first.id, ...rest.map((rift) => rift.id)] })];
  }

  private healBoss(cause: HealCause, requested: number, at: Tick): FightEvent {
    const beforeHp = this.currentStats.hitpoint;
    const afterHp = Math.min(this.stats.hitpoint, beforeHp + requested);
    this.currentStats.hitpoint = afterHp;
    this.healSplats = [...this.healSplats, { amount: afterHp - beforeHp, lastShown: after(at, HEAL_SPLAT_TICKS) }];
    return { kind: "boss-healed", at, cause, receipt: { requested, applied: afterHp - beforeHp, beforeHp, afterHp } };
  }

  private landed({ cause, receipt }: Landed<PlayerHit>): readonly FightEvent[] {
    switch (cause.kind) {
      case "deflect-reflected":
      case "floor-hit":
      case "hole-hit":
      case "void-hit":
      case "rift-burst":
        return [{ ...cause, receipt }];
      case "special-hit":
        if (receipt.prayer !== cause.style) this.stolen = [...this.stolen, { ordinal: cause.ordinal, credit: receipt.applied }];
        return [{ ...cause, receipt }];
      case "explosion-resolved":
        return [explosionHit(cause, receipt)];
      case "lifeforce-drained":
        return this.stepOrbs(formOrb(this.orbs, cause, receipt));
      default: {
        const unhandled: never = cause;
        return unhandled;
      }
    }
  }

  private stepOrbs<O>(step: OrbStep<O>): readonly O[] {
    this.orbs = step.orbs;
    return step.outputs;
  }

  private stepMarks(step: ExplosionStep): ExplosionStep["outputs"] {
    this.marks = step.marks;
    return step.outputs;
  }

  private settlePlayerHits(at: Tick, landed: readonly Landed<PlayerHit>[], player: Readonly<{ hp: number; maxHp: number }>): readonly (Logged<FightEvent> | Heal)[] {
    const returned = this.stepOrbs(returnDueOrbs(this.orbs, at, player.hp));
    const lethal = this.invincible() ? landed.find(({ receipt }) => receipt.beforeHp > 0 && receipt.afterHp === 0) : undefined;
    if (!lethal) return returned;
    const { orbs, cleared } = forgiveOrbDebt(this.orbs);
    this.orbs = orbs;
    return [...returned, { kind: "heal", amount: player.maxHp, limit: "max-hp" }, ...logs({ kind: "death-prevented", at, source: lethal.cause.kind, clearedOrbCredit: cleared })];
  }

  private closeRow({ time, inputs, snapshot, events, combatDraws, ending }: FrameOf<P4Run, "tick-ended">): Readonly<{ row: TickRow; ending: RunEnd | null }> {
    const playerAtPostTick = this.target.observe();
    const died = ending === null && playerAtPostTick.hp <= 0;
    const riftHits = snapshot.rifts.flatMap((rift) =>
      rift.mob.hitsThisTick.map((hit): FightEvent => ({ kind: "rift-hit", at: time.encounter, rift: rift.id, style: incomingStyle(hit.attackStyle), damage: hit.damage })),
    );
    const landed = [...events, ...riftHits];
    const { phase, beats } = this.schedule.at(time.encounter);
    const row: TickRow = {
      tick: time.encounter,
      worldTick: time.world,
      phase,
      playerAtBossStep: snapshot.player,
      inputs,
      beats: ending === null ? beats : [],
      events: died ? [...landed, { kind: "run-ended", at: time.encounter, reason: "death" }] : landed,
      playerAtPostTick,
      bossHp: { atBossStep: snapshot.bossHp, atPostTick: this.currentStats.hitpoint },
      combatDraws,
    };
    const end = ending ?? (died ? "death" : null);
    if (end === null) this.rifts = this.rifts.map((rift) => ({ ...rift, hpAtPostTick: rift.mob.currentStats.hitpoint }));
    return { row, ending: end };
  }
}

/** The SDK paths players through mobs and around blocking entities, so the boss's body is an entity over his tiles. */
export class BossFootprint extends InvisibleMovementBlocker {
  constructor(region: Region, private readonly boss: Ocellus) {
    super(region, { ...boss.location });
  }

  override get size(): number {
    return this.boss.size;
  }

  override get collisionType(): CollisionType {
    return this.boss.blocksMovement() ? CollisionType.BLOCK_MOVEMENT : CollisionType.NONE;
  }
}
