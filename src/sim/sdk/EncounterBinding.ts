import { Projectile, Random } from "osrs-sdk";
import type { Player, Unit } from "osrs-sdk";
import type { Seed, Tick, TickSpan, Tile, WorldTick } from "../brands";
import { tick, tile, worldTick } from "../brands";
import type { Damage, HitReceipt, IncomingStyle, Style } from "../combat";
import { cutAttackDelay } from "../combat";

export type Encounter = Readonly<{ input: unknown; event: unknown; cause: unknown; snapshot: unknown; row: unknown; end: unknown }>;

export type Time = Readonly<{ world: WorldTick; encounter: Tick }>;
/** `rolled` is the attacker's roll; `requested` is what the SDK will deal, the roll after its caps, the target's HP among them. */
export type IncomingHit = Readonly<{ style: IncomingStyle; rolled: number; requested: number; launchedAt: Tick }>;
export type Landed<C> = Readonly<{ cause: C; receipt: HitReceipt }>;

export type Logged<E> = Readonly<{ kind: "event"; event: E }>;
export type HitRequest<C> = Readonly<{ kind: "hit"; damage: Damage; cause: C }>;
export type Judgement = Readonly<{ kind: "judge-incoming"; hit: IncomingHit; damage: number }>;
export type Heal = Readonly<{ kind: "heal"; amount: number; limit: "max-hp" | "allow-overheal" }>;
export type AttackDelayCut = Readonly<{ kind: "cut-attack-delay"; by: TickSpan }>;

type FrameData<T extends Encounter> = {
  "tick-opened": Readonly<Record<never, never>>;
  "before-npc-hits": Readonly<{ incoming: readonly IncomingHit[] }>;
  "npc-turn": Readonly<{ snapshot: T["snapshot"]; player: Readonly<{ attackDelay: number }> }>;
  "hit-applied": Readonly<{ hit: Landed<T["cause"]> }>;
  "player-hits-settled": Readonly<{ landed: readonly Landed<T["cause"]>[]; player: Readonly<{ hp: number; maxHp: number }> }>;
  "player-moved": Readonly<{ steps: readonly Tile[]; at: Tile }>;
  "tick-ended": Readonly<{ inputs: readonly T["input"][]; snapshot: T["snapshot"]; events: readonly T["event"][]; combatDraws: number; ending: T["end"] | null }>;
};

export type FrameKind = keyof FrameData<Encounter>;
export type FrameOf<T extends Encounter, K extends FrameKind> = Readonly<{ kind: K; time: Time }> & FrameData<T>[K];
export type Frame<T extends Encounter> = { [K in FrameKind]: FrameOf<T, K> }[FrameKind];

type Replies<T extends Encounter> = {
  "tick-opened": void;
  "before-npc-hits": Readonly<{ snapshot: T["snapshot"]; outputs: readonly (Logged<T["event"]> | Judgement | HitRequest<T["cause"]>)[] }>;
  "npc-turn": Readonly<{ outputs: readonly (Logged<T["event"]> | HitRequest<T["cause"]> | AttackDelayCut)[]; ending: T["end"] | null }>;
  "hit-applied": readonly T["event"][];
  "player-hits-settled": readonly (Logged<T["event"]> | Heal)[];
  "player-moved": void;
  "tick-ended": Readonly<{ row: T["row"]; ending: T["end"] | null }>;
};

/**
 * Each active world tick calls these in this order: tick-opened, then on the driver's NPC turn before-npc-hits and npc-turn,
 * then on the player's turn hit-applied once per landed hit and player-hits-settled, then player-moved, then tick-ended.
 * After an ending, only hit-applied and tick-ended still run that tick. Settlement heals land before the SDK latches the player's death.
 */
export type Hooks<T extends Encounter> = { readonly [K in FrameKind]: (frame: FrameOf<T, K>) => Replies<T>[K] };

export type RunView<End> =
  | Readonly<{ kind: "waiting"; at: Tick }>
  | Readonly<{ kind: "running"; at: Tick }>
  | Readonly<{ kind: "ended"; at: Tick; reason: End }>;

type Turn<T extends Encounter> = Readonly<{
  time: Time;
  inputs: readonly T["input"][];
  snapshot: T["snapshot"];
  events: readonly T["event"][];
  landed: readonly Landed<T["cause"]>[];
  drawsAtTurn: number;
  ending: T["end"] | null;
}>;

type Run<T extends Encounter> =
  | Readonly<{ kind: "waiting"; inputs: readonly T["input"][] }>
  | Readonly<{ kind: "opened"; time: Time; inputs: readonly T["input"][] }>
  | (Readonly<{ kind: "turned" | "settled" | "moved" }> & Turn<T>)
  | Readonly<{ kind: "between"; last: Tick; inputs: readonly T["input"][] }>
  | Readonly<{ kind: "ended"; at: Tick; reason: T["end"] }>;

declare const inFlight: unique symbol;
export type InFlight = Projectile & { readonly [inFlight]: true };

/** The SDK lands a projectile on the tick its delay reaches 0, then keeps it in `incomingProjectiles` for its hitsplat. */
export function isInFlight(projectile: Projectile): projectile is InFlight {
  return projectile.remainingDelay > 0;
}

export function incomingStyle(attackStyle: string): IncomingStyle {
  switch (attackStyle) {
    case "stab":
    case "slash":
    case "crush":
      return "melee";
    case "range":
      return "ranged";
    case "magic":
      return "magic";
    default:
      return "typeless";
  }
}

export function protectionOf(player: Player): Style | null {
  if (player.prayerController.matchFeature("melee")) return "melee";
  if (player.prayerController.matchFeature("range")) return "ranged";
  if (player.prayerController.matchFeature("magic")) return "magic";
  return null;
}

function requestedDamage(damage: Damage, hp: number, prayer: Style | null): number {
  switch (damage.kind) {
    case "fixed":
      return damage.amount;
    case "fraction-current-hp":
      return Math.floor(hp / damage.divisor);
    case "by-prayer":
      return prayer === damage.style ? damage.protectedAmount : damage.unprotectedAmount;
    default: {
      const unhandled: never = damage;
      return unhandled;
    }
  }
}

function healed(player: Player, { amount, limit }: Heal): number {
  const hp = player.currentStats.hitpoint;
  switch (limit) {
    case "allow-overheal":
      return hp + amount;
    case "max-hp":
      return Math.max(hp, Math.min(player.stats.hitpoint, hp + amount));
    default: {
      const unhandled: never = limit;
      return unhandled;
    }
  }
}

class SimHit<C> extends Projectile {
  constructor(from: Unit, private readonly target: Player, private readonly request: HitRequest<C>, private readonly land: (hit: Landed<C>) => void) {
    super(null, 0, from, target, "typeless", { setDelay: 1, visuals: { hidden: true } });
  }

  override beforeHit(): void {
    super.beforeHit();
    const beforeHp = this.target.currentStats.hitpoint;
    const prayer = protectionOf(this.target);
    const requested = requestedDamage(this.request.damage, beforeHp, prayer);
    this.damage = Math.min(requested, beforeHp);
    this.land({ cause: this.request.cause, receipt: { requested, applied: this.damage, beforeHp, afterHp: beforeHp - this.damage, prayer } });
  }
}

class CombatStream {
  private state: number;
  draws = 0;

  constructor(seed: Seed) {
    this.state = (seed ^ 0x5eed0c0b) >>> 0;
  }

  next(): number {
    this.draws++;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  }
}

export class EncounterBinding<T extends Encounter> {
  private run: Run<T> = { kind: "waiting", inputs: [] };
  private readonly journal: T["row"][] = [];
  private readonly stream: CombatStream;
  private readonly rolls = new WeakMap<Projectile, number>();

  /**
   * `aim` names the unit the running phase treats as "the player": the one it observes, hits and heals. A solo run
   * always aims at its own player. In a shared fight every client aims at the one the room agreed the boss is on, so
   * only that person's own machine puts the damage on a real player and the rest put it on a puppet.
   */
  constructor(seed: Seed, private readonly start: Tick, private readonly aim: () => Player, private readonly hooks: Hooks<T>) {
    this.stream = new CombatStream(seed);
  }

  private get player(): Player {
    return this.aim();
  }

  get rows(): readonly T["row"][] {
    return this.journal;
  }

  view(): RunView<T["end"]> {
    const run = this.run;
    switch (run.kind) {
      case "waiting":
        return { kind: "waiting", at: this.start };
      case "opened":
      case "turned":
      case "settled":
      case "moved":
        return { kind: "running", at: run.time.encounter };
      case "between":
        return { kind: "running", at: run.last };
      case "ended":
        return { kind: "ended", at: run.at, reason: run.reason };
      default: {
        const unhandled: never = run;
        return unhandled;
      }
    }
  }

  input(input: T["input"]): void {
    const run = this.run;
    switch (run.kind) {
      case "waiting":
      case "opened":
      case "between":
      case "turned":
      case "settled":
      case "moved":
        this.run = { ...run, inputs: [...run.inputs, input] };
        return;
      case "ended":
        return;
      default: {
        const unhandled: never = run;
        return unhandled;
      }
    }
  }

  openTick(): void {
    const run = this.run;
    if (run.kind !== "waiting" && run.kind !== "between") return;
    const time = { world: worldTick(this.player.region.world.globalTickCounter), encounter: run.kind === "waiting" ? this.start : tick(run.last + 1) };
    this.run = { kind: "opened", time, inputs: run.inputs };
    this.hooks["tick-opened"]({ kind: "tick-opened", time });
  }

  npcTurn(actor: Unit, resolve: () => void): void {
    const run = this.run;
    if (run.kind !== "opened") {
      resolve();
      return;
    }
    const { time } = run;
    const drawsAtTurn = this.stream.draws;
    const landing = actor.incomingProjectiles
      .filter((projectile) => projectile.remainingDelay === 1 && !projectile.shouldDestroy())
      .map((projectile) => [this.incoming(projectile, time.encounter), projectile] as const);
    const judged = this.hooks["before-npc-hits"]({ kind: "before-npc-hits", time, incoming: landing.map(([hit]) => hit) });
    const before = this.apply(actor, judged.outputs, new Map(landing));
    resolve();
    const turned = this.hooks["npc-turn"]({ kind: "npc-turn", time, snapshot: judged.snapshot, player: { attackDelay: this.player.attackDelay } });
    const after = this.apply(actor, turned.outputs, new Map());
    this.run = { kind: "turned", time, inputs: run.inputs, snapshot: judged.snapshot, events: [...before, ...after], landed: [], drawsAtTurn, ending: turned.ending };
  }

  /** The SDK keeps a projectile's roll on its weapon, and the weapon's next attack overwrites it. */
  received(projectile: Projectile): void {
    if (projectile.weapon) this.rolls.set(projectile, projectile.weapon.damageRoll);
  }

  landing(projectile: InFlight): Readonly<{ hit: IncomingHit; at: Tick }> {
    const at = tick(this.nextNpcTurn() + projectile.remainingDelay - 1);
    return { hit: this.incoming(projectile, at), at };
  }

  playerHitsSettled(): void {
    const run = this.run;
    if (run.kind !== "turned") return;
    const { time } = run;
    const applied = run.landed.flatMap((hit) => this.hooks["hit-applied"]({ kind: "hit-applied", time, hit }));
    const player = { hp: this.player.currentStats.hitpoint, maxHp: this.player.stats.hitpoint };
    const settled = run.ending === null ? this.hooks["player-hits-settled"]({ kind: "player-hits-settled", time, landed: run.landed, player }).flatMap((output) => this.settle(output)) : [];
    this.run = { ...run, kind: "settled", events: [...run.events, ...applied, ...settled], landed: [] };
  }

  playerMovement(resolve: () => void): void {
    resolve();
    const run = this.run;
    if (run.kind !== "settled") return;
    this.run = { ...run, kind: "moved" };
    if (run.ending === null) {
      const steps = this.player.stepsThisTick.map(({ x, y }) => tile(x, y));
      this.hooks["player-moved"]({ kind: "player-moved", time: run.time, steps, at: tile(this.player.location.x, this.player.location.y) });
    }
  }

  finishTick(): T["row"] | null {
    const run = this.run;
    switch (run.kind) {
      case "waiting":
      case "between":
      case "ended":
        return null;
      case "opened":
        this.run = { kind: "between", last: run.time.encounter, inputs: run.inputs };
        return null;
      case "turned":
      case "settled":
      case "moved": {
        const { time, inputs, snapshot, events, ending } = run;
        const closed = this.hooks["tick-ended"]({ kind: "tick-ended", time, inputs, snapshot, events, combatDraws: this.stream.draws - run.drawsAtTurn, ending });
        this.journal.push(closed.row);
        this.run = closed.ending === null ? { kind: "between", last: time.encounter, inputs: [] } : { kind: "ended", at: time.encounter, reason: closed.ending };
        return closed.row;
      }
      default: {
        const unhandled: never = run;
        return unhandled;
      }
    }
  }

  combat(step: () => void): void {
    const previous = Random.randomFn;
    Random.setRandom(() => this.stream.next());
    try {
      step();
    } finally {
      Random.setRandom(previous);
    }
  }

  private nextNpcTurn(): Tick {
    const run = this.run;
    switch (run.kind) {
      case "waiting":
        return this.start;
      case "opened":
        return run.time.encounter;
      case "turned":
      case "settled":
      case "moved":
        return tick(run.time.encounter + 1);
      case "between":
        return tick(run.last + 1);
      case "ended":
        return tick(run.at + 1);
      default: {
        const unhandled: never = run;
        return unhandled;
      }
    }
  }

  private incoming(projectile: Projectile, landsAt: Tick): IncomingHit {
    const rolled = this.rolls.get(projectile) ?? projectile.damage;
    return { style: incomingStyle(projectile.attackStyle), rolled, requested: projectile.damage, launchedAt: tick(Math.max(0, landsAt - projectile.totalDelay)) };
  }

  private land(hit: Landed<T["cause"]>): void {
    const run = this.run;
    if (run.kind === "turned") this.run = { ...run, landed: [...run.landed, hit] };
  }

  private settle(output: Logged<T["event"]> | Heal): readonly T["event"][] {
    switch (output.kind) {
      case "event":
        return [output.event];
      case "heal":
        this.player.currentStats.hitpoint = healed(this.player, output);
        return [];
      default: {
        const unhandled: never = output;
        return unhandled;
      }
    }
  }

  private apply(actor: Unit, outputs: readonly (Logged<T["event"]> | Judgement | HitRequest<T["cause"]> | AttackDelayCut)[], incoming: ReadonlyMap<IncomingHit, Projectile>): readonly T["event"][] {
    return outputs.flatMap((output) => {
      switch (output.kind) {
        case "event":
          return [output.event];
        case "hit":
          this.player.addProjectile(new SimHit(actor, this.player, output, (hit) => this.land(hit)));
          return [];
        case "judge-incoming": {
          const projectile = incoming.get(output.hit);
          if (projectile) projectile.damage = output.damage;
          return [];
        }
        case "cut-attack-delay":
          this.player.attackDelay = cutAttackDelay(this.player.attackDelay, output.by);
          return [];
        default: {
          const unhandled: never = output;
          return unhandled;
        }
      }
    });
  }
}
