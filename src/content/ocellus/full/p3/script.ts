import type { Tick, TickSpan } from "../../../../sim/brands";
import { after, span } from "../../../../sim/brands";
import type { Style } from "../../../../sim/combat";
import type { Entries } from "../../../../sim/encounter";
import type { Script } from "../../../../sim/script";
import type { Handle } from "../../../../sim/timers";
import type { Sourced } from "../../../../sim/sourced";
import { each, minus, plus } from "../../../../sim/sourced";
import type { ATile, Arm, Body, Quadrant } from "../../fight/geometry";
import {
  ARMS,
  CORNERS,
  QUADRANTS,
  QUADRANT_SIGN,
  armBetween,
  armsOf,
  at,
  bodyCentre,
  clockwise,
  covers,
  distanceToBody,
  inRoom,
  quadrantOf,
  quadrantTiles,
  reach,
  same,
  sign,
  stonesOf,
  turnInto,
} from "../../fight/geometry";
import { seqSourced as SEQ, spotSourced as SPOT } from "../data/looks";
import { T, V } from "./data";
import type { Fall, God, P3Cause, P3Ctx, P3Entry, P3Outcome, P3Stage, P3Types, PatchEnd, RiftKind, Special, Tone } from "./types";
import type { Add, P3World } from "./world";

type Patch = Readonly<{ tile: ATile; placed: Tick; end: PatchEnd }>;
type Crossing = Readonly<{ from: Quadrant; to: Quadrant; bank: ATile; jumps: readonly [ATile, ...ATile[]]; started: boolean }>;

const RIFT_ORDER: readonly [RiftKind, ...RiftKind[]] = ["rift-buff", "rift-basic", "rift-heal"];
const GOD_NAME: Readonly<Record<God, string>> = { bandos: "Bandosian", saradomin: "Saradomin", armadyl: "Armadylean", zaros: "Zarosian" };
const GOD_GLOW: Readonly<Record<God, Sourced<number>>> = { bandos: SPOT.glowBandos, saradomin: SPOT.glowSaradomin, armadyl: SPOT.glowArmadyl, zaros: SPOT.glowZaros };
const VINE_LINES = ["The void... will take you...", "Await... the void...", "Your panic... is futile..."] as const;
const ESCAPE_LINES = ["You can't... escape... the end...", "This end... comes...", "Everything... ends..."] as const;
/** He starts phase 3 in the middle, facing the south entrance. */
const MIDDLE_FACING = at(0, 10);
const ARENA_CENTRE = at(0, 0);

/** Tiles of the "+" and the middle 5x5 that phase 3 turns into chasm. */
export function chasmTiles(): ATile[] {
  const tiles: ATile[] = [];
  for (let x = -12; x <= 12; x++) {
    for (let z = -12; z <= 12; z++) {
      const t = at(x, z);
      if (!inRoom(t)) continue;
      if (Math.abs(x) <= 1 || Math.abs(z) <= 1 || (Math.abs(x) <= 2 && Math.abs(z) <= 2)) tiles.push(t);
    }
  }
  return tiles;
}

function sideQuadrant(t: ATile): Quadrant {
  if (t.x >= 0) return t.z >= 0 ? "NE" : "SE";
  return t.z >= 0 ? "NW" : "SW";
}

function bankBeside(stone: ATile, arm: Arm, q: Quadrant): ATile {
  const { sx, sz } = QUADRANT_SIGN[q];
  return arm === "N" || arm === "S" ? at(2 * sx, stone.z) : at(stone.x, 2 * sz);
}

function quadrantsOfArm(arm: Arm): readonly [Quadrant, Quadrant] {
  const found = QUADRANTS.filter((q) => armsOf(q).includes(arm));
  return [found[0], found[1]];
}

function bodyCentreTile(body: Body): ATile {
  const c = bodyCentre(body);
  return at(Math.round(c.x), Math.round(c.z));
}

function lineBetween(a: ATile, b: ATile): ATile[] {
  const tiles: ATile[] = [];
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z));
  for (let i = 1; i < steps; i++) tiles.push(at(Math.round(a.x + ((b.x - a.x) * i) / steps), Math.round(a.z + ((b.z - a.z) * i) / steps)));
  return tiles;
}

function outlasts(a: PatchEnd, b: PatchEnd): boolean {
  if (a.kind === "quadrant") return true;
  if (b.kind === "quadrant") return false;
  return a.tick >= b.tick;
}

function nonEmpty<V>(list: readonly V[]): readonly [V, ...V[]] | null {
  const [first, ...rest] = list;
  return first === undefined ? null : [first, ...rest];
}

/**
 * Phase 3 as closures on the engine: his chain of swings and slashes, the spin, Untether and Insolence, the bombs, vine,
 * rifts and patches, the stepping stones and censers, and each quadrant's fall. Every timing comes from his data.
 */
export class P3Script<E extends Entries> implements Script<E, P3Types> {
  private stage: P3Stage = { kind: "arriving" };
  private segment = 0;
  private quadrant: Quadrant = "SE";
  private specials = 0;
  private quadrantSpins = 0;
  private quadrantOthers = 0;
  private riftKind: RiftKind | null = null;
  /** The next rift's timer, and whether one fell due during a spin and waits for his next move. */
  private riftTimer: Handle | null = null;
  private riftOwed = false;
  private floorFraction: number = V.hpFloors.value[0];
  private patches: readonly Patch[] = [];
  private vine: Add | null = null;
  private rifts: readonly Add[] = [];
  private crossing: Crossing | null = null;
  private lastFlyingMessage = -10;
  private prayerLeft = 1;
  private ending: P3Outcome = { kind: "running" };
  private ctx: P3Ctx<E> | null = null;

  constructor(
    private readonly world: P3World,
    private readonly entry: P3Entry,
    private readonly fallen: (m: P3Ctx<E>, fall: Fall) => void,
  ) {}

  get current(): P3Stage {
    return this.stage;
  }

  get outcome(): P3Outcome {
    return this.ending;
  }

  begin(m: P3Ctx<E>): void {
    this.ctx = m;
    m.boss.targetable(false);
    m.boss.faceTile(MIDDLE_FACING);
    if (this.entry.kind === "fresh") this.chat(m, "Challenge started: Ocellus.", "game");
    this.breakArena(m);
    m.afterPhase(T.jumpToCornerAfter, (n) => this.startSegment(n, quadrantOf(n.player.tile) ?? "SE", "jump"));
  }

  each(m: P3Ctx<E>): void {
    this.tick(m);
    this.practice(m);
  }

  landed(m: P3Ctx<E>, cause: P3Cause): void {
    switch (cause.kind) {
      case "panic":
        this.playerSpot(m, SPOT.magicImpact, "impact");
        this.addPatch(m, m.player.tile, { kind: "at", tick: after(m.now, this.lasting(m)) }, "aoe");
        return;
      case "untether-magic":
        this.playerSpot(m, SPOT.magicImpact, "impact");
        return;
      case "swing":
      case "slash":
      case "spin-opening":
      case "saw":
      case "bomb":
      case "debris":
      case "superior-slash":
      case "rift-detonation":
      case "rift-heal":
      case "siphon-kill":
      case "void-patch":
      case "slam":
      case "aftershock":
        return;
      default: {
        const unhandled: never = cause;
        return unhandled;
      }
    }
  }

  private breakArena(m: P3Ctx<E>): void {
    this.world.removeFloor(chasmTiles());
    this.world.setStones(ARMS.flatMap((arm) => stonesOf(arm)));
    m.show({ kind: "arena-broke" });
    const here = m.player.tile;
    if (this.world.isWalkable(here)) return;
    const { sx, sz } = QUADRANT_SIGN[quadrantOf(here) ?? sideQuadrant(here)];
    this.world.fighter.hop(at(Math.abs(here.x) < 3 ? 3 * sx : here.x, Math.abs(here.z) < 3 ? 3 * sz : here.z));
  }

  /** He lands in a corner and starts the quadrant's chain of moves; his specials carry on from the last quadrant. */
  private startSegment(m: P3Ctx<E>, wanted: Quadrant, arrival: "jump" | "appear"): void {
    const q = this.world.destroyed.has(wanted) ? QUADRANTS.find((other) => !this.world.destroyed.has(other)) ?? wanted : wanted;
    m.endSegment();
    this.quadrant = q;
    this.floorFraction = V.hpFloors.value[this.segment];
    this.stage = { kind: "chain" };
    this.quadrantSpins = 0;
    this.quadrantOthers = 0;
    if (arrival === "jump") m.boss.jump(CORNERS[q], T.jump);
    else m.boss.place(CORNERS[q]);
    m.boss.targetable(true);
    m.boss.hold(null);
    m.boss.overhead(null);
    m.boss.facePlayer();
    m.log({ kind: "segment-started", at: m.now, segment: this.segment, quadrant: q });
    const plan = this.segment === 0 ? T.segment.first : T.segment.later;
    for (const drop of each(plan.bombs)) {
      m.after(minus(drop, T.bombOverheadBefore), (n) => this.bombOverhead(n));
      m.after(minus(drop, T.bombDropAfter), (n) => this.bombs(n));
    }
    if (this.segment > 0) this.rifting(m, T.riftsAfter);
    this.riftKind = this.riftKind === null ? m.pick("rift-kind", RIFT_ORDER) : RIFT_ORDER[(RIFT_ORDER.indexOf(this.riftKind) + 1) % RIFT_ORDER.length];
    this.next(m, T.firstMove, (n) => this.swing(n, 0, 0));
  }

  /** His next move in the chain. If his HP is at the floor by then, the quadrant falls instead. */
  private next(m: P3Ctx<E>, wait: Sourced<TickSpan>, move: (m: P3Ctx<E>) => void): void {
    m.after(wait, (n) => {
      if (this.collapseDue(n)) return;
      move(n);
    });
  }

  /**
   * After two sets of swings, his next special. The spin comes every other one through the whole phase; in between,
   * Untether and Insolence take turns within the quadrant, Untether first in the first quadrant, Insolence later.
   */
  private special(m: P3Ctx<E>): void {
    const special: Special = this.specials % 2 === 0 ? "spin" : this.nextOther();
    this.specials++;
    m.log({ kind: "special-started", at: m.now, special });
    switch (special) {
      case "spin":
        return this.spin(m);
      case "insolence":
        return this.insolence(m);
      case "untether":
        return this.untether(m);
      default: {
        const unhandled: never = special;
        return unhandled;
      }
    }
  }

  private nextOther(): "untether" | "insolence" {
    const first = (this.segment === 0 ? V.first : V.later).firstOther.value;
    const other = this.quadrantOthers % 2 === 0 ? first : first === "untether" ? "insolence" : "untether";
    this.quadrantOthers++;
    return other;
  }

  private body(m: P3Ctx<E>): Body {
    return { sw: m.boss.at, size: 3 };
  }

  private inMelee(m: P3Ctx<E>): boolean {
    const here = m.player.tile;
    const body = this.body(m);
    if (distanceToBody(body, here) !== 1) return false;
    const insideX = here.x >= body.sw.x && here.x <= body.sw.x + 2;
    const insideZ = here.z >= body.sw.z && here.z <= body.sw.z + 2;
    return insideX || insideZ;
  }

  /**
   * One of a set's two swings: melee at everyone near him, landing on its animation. With nobody in his reach, his magic
   * shot (no shout) takes the swing's place and the chain runs 3 ticks late.
   */
  private swing(m: P3Ctx<E>, set: number, swung: 0 | 1): void {
    this.stage = { kind: "chain" };
    let gap: Sourced<TickSpan> = T.swingGap;
    if (this.inMelee(m)) {
      m.boss.play(SEQ.p3MeleeBasic);
      m.boss.facePlayer();
      m.hitByPrayer({ kind: "swing" }, "melee", V.basicHitProtected, V.basicHitUnprotected);
    } else {
      this.panic(m);
      gap = T.afterPanic;
    }
    if (swung === 0) {
      this.next(m, gap, (n) => this.swing(n, set, 1));
      return;
    }
    m.after(minus(gap, T.slashShowsBefore), (n) => {
      const band = this.slashLine(n);
      n.show({ kind: "danger", role: "slash", tiles: band, until: after(after(n.now, T.slashShowsBefore.value), T.slashLands.value) });
      this.next(n, T.slashShowsBefore, (o) => this.slash(o, band, set));
    });
  }

  /** The shadow slash ends a set, landing the tick after its animation; his next move comes 4 ticks after it. */
  private slash(m: P3Ctx<E>, band: readonly ATile[], set: number): void {
    m.boss.play(SEQ.p3MeleeSlash);
    m.boss.facePlayer();
    m.afterPhase(T.slashLands, (n) => {
      n.show({ kind: "band-landed", role: "slash", tiles: band });
      if (band.some((t) => same(t, n.player.tile))) n.hit({ kind: "slash" }, V.slashDamage);
    });
    if (set + 1 < V.setsPerSpecial.value) {
      this.next(m, T.afterSlash, (n) => this.swing(n, set + 1, 0));
      return;
    }
    this.next(m, T.afterSlash, (n) => this.special(n));
  }

  /**
   * The shadow slash: 3 wide from the ring touching his body to the platform's edge, toward you, snapped to the nearest
   * of 8 directions from his middle tile.
   */
  private slashLine(m: P3Ctx<E>): readonly ATile[] {
    const mid = bodyCentreTile(this.body(m));
    const here = m.player.tile;
    const octant = same(here, mid) ? 2 : Math.round(Math.atan2(here.z - mid.z, here.x - mid.x) / (Math.PI / 4));
    const ux = Math.round(Math.cos((octant * Math.PI) / 4));
    const uz = Math.round(Math.sin((octant * Math.PI) / 4));
    const inBand = (dx: number, dz: number): boolean => {
      if (ux === 0) return Math.abs(dx) <= 1 && dz * uz >= 2;
      if (uz === 0) return Math.abs(dz) <= 1 && dx * ux >= 2;
      return dx * ux >= 1 && dz * uz >= 1 && Math.abs(dx * ux - dz * uz) <= 1 && !(Math.abs(dx) <= 1 && Math.abs(dz) <= 1);
    };
    return this.byDistance(m, this.platform().filter((t) => inBand(t.x - mid.x, t.z - mid.z)));
  }

  /** Insolence: floor tiles in a band `width` wide at any angle, from just outside his body toward you, to the edge. */
  private bandTowardsPlayer(m: P3Ctx<E>, width: number): readonly ATile[] {
    const centre = bodyCentre(this.body(m));
    const here = m.player.tile;
    let ux = here.x - centre.x;
    let uz = here.z - centre.z;
    const length = Math.hypot(ux, uz);
    if (length === 0) [ux, uz] = [0, 1];
    else [ux, uz] = [ux / length, uz / length];
    return this.byDistance(
      m,
      this.platform().filter((t) => {
        const rx = t.x - centre.x;
        const rz = t.z - centre.z;
        return rx * ux + rz * uz >= 1.5 && Math.abs(rx * -uz + rz * ux) <= width / 2;
      }),
    );
  }

  private platform(): ATile[] {
    return quadrantTiles(this.quadrant).filter((t) => this.world.isFloor(t));
  }

  private byDistance(m: P3Ctx<E>, tiles: ATile[]): ATile[] {
    const centre = bodyCentre(this.body(m));
    return tiles.sort((a, b) => Math.hypot(a.x - centre.x, a.z - centre.z) - Math.hypot(b.x - centre.x, b.z - centre.z));
  }

  /**
   * The charged blade: one saw per quadrant he has destroyed, plus one. Saw i cuts at P+5+3i, on its loop animation. An
   * overhead up on the tick before is severed; Protect from Melee up as it cuts blocks it.
   */
  private spin(m: P3Ctx<E>): void {
    this.stage = { kind: "spin" };
    m.boss.play(SEQ.p3PrayerIn);
    m.boss.spotanim(SPOT.meleePrayerIn, "spin");
    m.after(this.segment === 0 ? T.debrisIntoSpin.first : T.debrisIntoSpin.later, (n) => this.debris(n));
    m.after(T.spinOpens, (n) => {
      if (reach(n.player.tile, n.boss.at) <= V.spinReach.value) n.hitPrayable({ kind: "spin-opening" }, "melee", V.spinOpeningDamage);
    });
    const loops = this.world.destroyed.size;
    let cut: Sourced<TickSpan> = T.sawFirstCut;
    for (let i = 0; i <= loops; i++) {
      const last = i === loops;
      if (i > 0) cut = plus(cut, T.sawEvery);
      m.after(minus(cut, T.sawShowsBefore), (n) => n.boss.spotanim(last ? SPOT.meleePrayerOut : SPOT.meleePrayer, "spin"));
      m.after(minus(cut, T.severBefore), (n) => this.sever(n));
      m.after(cut, (n) => {
        n.boss.play(last ? SEQ.p3PrayerOut : SEQ.p3PrayerLoop);
        if (last) this.stage = { kind: "chain" };
        if (reach(n.player.tile, n.boss.at) > V.spinReach.value) return;
        n.hitPrayable({ kind: "saw" }, "melee", V.spinDamage);
      });
    }
    this.quadrantSpins++;
    const vine = V.vineAfterSpins.value.some((n) => n === this.quadrantSpins);
    this.next(m, plus(cut, T.afterSpin), (n) => {
      if (vine) this.spawnVine(n);
      if (this.riftOwed) this.riftDue(n);
      this.swing(n, 0, 0);
    });
  }

  private sever(m: P3Ctx<E>): void {
    if (this.world.fighter.protection === null) return;
    this.world.fighter.sever(T.severTicks.value);
    m.log({ kind: "prayer-severed", at: m.now });
    this.chat(m, "Ocellus disrupts your concentration, severing your prayer!", "red");
    this.chat(m, "You've been injured and can't use protection prayers!", "red");
  }

  /** His magic shot at everyone, landing 2 ticks on, that leaves a void patch. He says nothing with it. */
  private panic(m: P3Ctx<E>): void {
    m.boss.play(SEQ.p3ProjectileAll);
    m.boss.spotanim(SPOT.magicOnBoss, "magic");
    this.shoot(m, T.panicLands, "panic");
  }

  private shoot(m: P3Ctx<E>, flight: Sourced<TickSpan>, cause: "panic" | "untether-magic"): void {
    m.show({ kind: "projectile", id: SPOT.magicProjectile.value, from: "boss", to: "player", flight: flight.value });
    m.afterPhase(flight, (n) => n.hitPrayable({ kind: cause }, "magic", cause === "panic" ? V.volleyDamage : V.untether.magicDamage));
  }

  /**
   * Void bombs: one over you and one on the same tile turned into each other standing quadrant. Each shows over you 5
   * ticks before it drops and on its tile 2 before, and leaves a void that stays until its quadrant falls.
   */
  private bombOverhead(m: P3Ctx<E>): void {
    this.playerSpot(m, SPOT.bombSpawn, "bomb", true);
    m.afterPhase(T.idleAfter, (n) => this.playerSpot(n, SPOT.bombIdle, "bomb", true));
  }

  private bombs(m: P3Ctx<E>): void {
    const here = m.player.tile;
    const from = quadrantOf(here) ?? sideQuadrant(here);
    for (const q of QUADRANTS) {
      if (this.world.destroyed.has(q)) continue;
      const tile = turnInto(here, from, q);
      if (!this.world.isWalkable(tile) || covers(this.body(m), tile)) continue;
      const drops = after(m.now, T.bombDropAfter.value);
      m.show({ kind: "bomb-shown", tile, drops });
      m.show({ kind: "danger", role: "bomb", tiles: [tile], until: drops });
      m.afterPhase(T.bombDropAfter, (n) => {
        n.show({ kind: "bomb-dropped", tile });
        if (same(n.player.tile, tile)) n.hit({ kind: "bomb" }, V.bombDamage);
        this.addPatch(n, tile, { kind: "quadrant" }, "bomb");
      });
    }
  }

  /** Rubble over you during the spin: it falls slowly, so one step clears it, and leaves a void patch. */
  private debris(m: P3Ctx<E>): void {
    if (this.airborne()) return;
    const tile = m.player.tile;
    const falls = after(m.now, T.debrisFalls.value);
    m.show({ kind: "debris-shown", tile, falls });
    m.show({ kind: "danger", role: "debris", tiles: [tile], until: falls });
    m.afterPhase(T.debrisFalls, (n) => {
      if (same(n.player.tile, tile)) n.hit({ kind: "debris" }, V.debrisDamage);
      this.addPatch(n, tile, { kind: "at", tick: after(n.now, this.lasting(n)) }, "aoe");
    });
  }

  private lasting(m: P3Ctx<E>): TickSpan {
    return span(m.roll("patch-lasts", V.patchLasts));
  }

  /** A patch replaces a shorter-lived one on its tile; a bomb's void outlasts anything dropped on it later. */
  private addPatch(m: P3Ctx<E>, tile: ATile, end: PatchEnd, loc: "bomb" | "aoe" | "insolence"): void {
    if (!this.world.isFloor(tile)) return;
    if (this.patches.some((p) => same(p.tile, tile) && outlasts(p.end, end))) return;
    this.patches = [...this.patches.filter((p) => !same(p.tile, tile)), { tile, placed: m.now, end }];
    m.show({ kind: "patch", tile, placed: m.now, end, loc });
  }

  /** One of his three vine shouts, and 3 ticks later a vine roots you where you stand then. */
  private spawnVine(m: P3Ctx<E>): void {
    m.boss.say(m.pick("shout", VINE_LINES), T.shoutLasts.long);
    m.after(T.vineRootsAfter, (n) => {
      if (!this.airborne()) this.rootInVine(n);
    });
  }

  private rootInVine(m: P3Ctx<E>): void {
    this.releaseVine(m, "lifted");
    const tile = m.player.tile;
    const vine = this.world.spawn("vine", tile, () => this.vineBroken(m, "broken"));
    this.vine = vine;
    this.world.fighter.freeze(T.vineHolds.value);
    this.playerSpot(m, SPOT.entangleStart, "vine");
    m.afterPhase(T.idleAfter, (n) => this.playerSpot(n, SPOT.entangleIdle, "vine"));
    this.chat(m, "You've been rooted in place!", "red");
    m.log({ kind: "vine-rooted", at: m.now, tile });
    if (this.world.soloVine) {
      this.world.fighter.target(vine);
      return;
    }
    m.afterPhase(T.vineCutByTeammate, (n) => {
      if (this.vine === vine) this.vineBroken(n, "cut-by-teammate");
    });
  }

  private vineBroken(m: P3Ctx<E>, how: "broken" | "cut-by-teammate"): void {
    if (this.vine === null) return;
    this.chat(m, "You break free of the vine.", "green");
    this.releaseVine(m, how);
  }

  private releaseVine(m: P3Ctx<E>, how: "broken" | "cut-by-teammate" | "lifted"): void {
    const vine = this.vine;
    if (vine === null) return;
    this.vine = null;
    vine.remove();
    this.world.fighter.unfreeze();
    this.playerSpot(m, SPOT.entangleEnd, "vine");
    m.log({ kind: "vine-released", at: m.now, how });
  }

  /** "Insolence...": three superior slashes, then his swings again 20 ticks after the shout. */
  private insolence(m: P3Ctx<E>): void {
    this.stage = { kind: "chain" };
    m.boss.say("Insolence...", T.shoutLasts.short);
    let lands: Sourced<TickSpan> = T.insolenceFirst;
    for (let i = 0; i < V.insolenceSlashes.value; i++) {
      if (i > 0) lands = plus(lands, T.insolenceEvery);
      m.after(lands, (n) => this.superiorSlash(n));
    }
    this.next(m, T.afterInsolence, (n) => this.swing(n, 0, 0));
  }

  /**
   * A band at you at any angle, landing 3 ticks after his animation. He turns only to the band. The wiki: Insolence's
   * waves "leave a lasting damaging field where they impact", so every tile of the band gets the field.
   */
  private superiorSlash(m: P3Ctx<E>): void {
    const band = this.bandTowardsPlayer(m, V.waveWidth.value);
    m.boss.play(SEQ.p3SuperiorSlash);
    m.boss.faceTile(m.player.tile);
    m.show({ kind: "danger", role: "superior-slash", tiles: band, until: after(m.now, T.insolenceLands.value) });
    m.afterPhase(T.insolenceLands, (n) => {
      n.show({ kind: "band-landed", role: "superior-slash", tiles: band });
      if (band.some((t) => same(t, n.player.tile))) n.hit({ kind: "superior-slash" }, V.insolenceDamage);
      for (const t of band) this.addPatch(n, t, { kind: "at", tick: after(n.now, T.insolenceDebrisLasts.value) }, "insolence");
    });
  }

  /** The next rift `wait` on, replacing any due or owed; one that falls due during a spin waits for his next move. */
  private rifting(m: P3Ctx<E>, wait: Sourced<TickSpan>): void {
    if (this.riftTimer !== null) m.cancel(this.riftTimer);
    this.riftOwed = false;
    this.riftTimer = m.after(wait, (n) => {
      if (this.stage.kind === "spin") this.riftOwed = true;
      else this.riftDue(n);
    });
  }

  private riftDue(m: P3Ctx<E>): void {
    this.spawnRift(m);
    this.rifting(m, T.riftEvery);
  }

  private spawnRift(m: P3Ctx<E>): void {
    const kind = this.riftKind ?? "rift-basic";
    const tiles = nonEmpty(quadrantTiles(this.quadrant).filter((t) => this.world.isWalkable(t) && distanceToBody(this.body(m), t) >= V.riftClearance.value));
    if (tiles === null) return;
    const tile = m.pick("rift-tile", tiles);
    const rift = this.world.spawn(kind, tile, (add) => this.riftKilled(m, add, kind));
    this.rifts = [...this.rifts, rift];
    m.log({ kind: "rift-spawned", at: m.now, rift: kind, tile });
    m.afterPhase(T.riftDetonatesAfter, (n) => {
      if (!rift.alive || !this.rifts.includes(rift)) return;
      this.rifts = this.rifts.filter((r) => r !== rift);
      rift.detonate();
      n.show({ kind: "rift-detonated", tile });
      n.hit({ kind: "rift-detonation" }, V.riftDetonationDamage);
    });
    if (kind !== "rift-heal") return;
    const heal = (n: P3Ctx<E>) => {
      if (!rift.alive || !this.rifts.includes(rift)) return;
      const centre = bodyCentreTile(this.body(n));
      n.show({ kind: "projectile", id: SPOT.healingFlare.value, from: tile, to: "boss", flight: T.idleAfter.value });
      if (!lineBetween(tile, centre).some((t) => same(t, n.player.tile))) n.heal({ kind: "rift-heal" }, n.pick("heal-amount", V.healRiftHeal.value), "boss");
      n.afterPhase(T.healRiftEvery, heal);
    };
    m.afterPhase(T.healRiftEvery, heal);
  }

  private riftKilled(m: P3Ctx<E>, add: Add, kind: RiftKind): void {
    this.rifts = this.rifts.filter((r) => r !== add);
    m.log({ kind: "rift-killed", at: m.now, rift: kind });
    if (kind === "rift-heal") {
      m.heal({ kind: "siphon-kill" }, V.siphonHeal.value, "player");
      return;
    }
    this.chat(m, `Destroying the ${kind === "rift-buff" ? "void augmenter" : "void rift"} empowers you!`, "purple");
    this.playerSpot(m, kind === "rift-buff" ? SPOT.glowZaros : SPOT.glowArmadyl, "empower");
    if (kind === "rift-buff") this.world.fighter.boost(V.augmenterBoost.melee.value, V.augmenterBoost.rangedMagic.value);
    else this.world.fighter.resetAttackDelay();
  }

  /** His next rift is 3 after the slam lands, if the quadrant stands: a fall at U+31 ends the segment and drops it. */
  private untether(m: P3Ctx<E>): void {
    const q = this.quadrant;
    this.releaseVine(m, "lifted");
    m.boss.say("Untether...", T.shoutLasts.short);
    m.boss.jump(CORNERS[q], T.jump);
    m.boss.faceTile(ARENA_CENTRE);
    m.boss.play(SEQ.p3UnleashIn);
    m.boss.overhead("protect-melee");
    const zone = this.body(m);
    this.stage = { kind: "untether", quadrant: q, zone };
    const u = T.untether;
    this.rifting(m, plus(u.slam, T.riftsAfter));
    m.show({ kind: "zone", body: zone, erupts: after(m.now, u.erupt.value), slams: after(m.now, u.slam.value) });
    m.afterPhase(T.poseLoopAfter, (n) => n.boss.hold(SEQ.p3UnleashLoop));
    each(u.pools).forEach((wave, n) => m.afterPhase(wave, (o) => this.untetherPools(o, zone, n > 0)));
    for (const lands of each(u.magic)) m.afterPhase(minus(lands, u.magicFlight), (n) => this.shoot(n, u.magicFlight, "untether-magic"));
    m.afterPhase(u.unleashVfx, (n) => n.boss.spotanim(SPOT.unleashOnBoss, "unleash"));
    m.afterPhase(u.erupt, (n) => n.show({ kind: "untether-flare", quadrant: q, tile: bodyCentreTile(zone) }));
    m.afterPhase(u.slam, (n) => {
      n.boss.hold(null);
      n.boss.play(SEQ.p3UnleashOut);
      n.show({ kind: "zone-cleared" });
      if (!covers(this.body(n), n.player.tile)) n.hit({ kind: "slam" }, V.untether.slamDamage);
    });
    m.afterPhase(u.aftershock, (n) => {
      if (covers(this.body(n), n.player.tile)) n.hit({ kind: "aftershock" }, V.untether.aftershockDamage);
    });
    m.afterPhase(u.obliteration, (n) => this.obliterateWhenDue(n, q));
  }

  /** The magic's splash, not a hazard: from the second wave one lands under you as the shot hits. */
  private untetherPools(m: P3Ctx<E>, zone: Body, underYou: boolean): void {
    const here = m.player.tile;
    let left = quadrantTiles(this.quadrant).filter((t) => this.world.isWalkable(t) && !same(t, here) && !covers(zone, t));
    const extras: ATile[] = [];
    const count = m.roll("pool-count", V.untether.poolsPerWave) - (underYou ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const from = nonEmpty(left);
      if (from === null) break;
      const tile = m.pick("pool-tiles", from);
      extras.push(tile);
      left = left.filter((t) => t !== tile);
    }
    m.show({ kind: "pools", tiles: underYou ? [here, ...extras] : extras });
  }

  /** His HP shown as a whole percentage is down to this quadrant's 75 / 50 / 25: under 76% and so on. */
  private atThreshold(m: P3Ctx<E>): boolean {
    const shown = Math.floor((100 * m.boss.hp) / m.boss.maxHp);
    return shown <= Math.round(this.floorFraction * 100);
  }

  /** At the quadrant's floor the quadrant falls on the next tick, whatever he is doing. Attacks under way still land. */
  private collapseDue(m: P3Ctx<E>): boolean {
    if ((this.stage.kind !== "chain" && this.stage.kind !== "spin") || !this.atThreshold(m)) return false;
    this.obliterate(m, this.quadrant);
    return true;
  }

  /** After Untether the quadrant falls if his HP is already at its floor. Otherwise it stands, and he swings again at U+37. */
  private obliterateWhenDue(m: P3Ctx<E>, q: Quadrant): void {
    if (this.atThreshold(m)) {
      this.obliterate(m, q);
      return;
    }
    this.stage = { kind: "chain" };
    m.boss.hold(null);
    m.boss.overhead(null);
    m.boss.facePlayer();
    this.next(m, minus(T.untether.swingsAgain, T.untether.obliteration), (n) => this.swing(n, 0, 0));
  }

  private obliterate(m: P3Ctx<E>, q: Quadrant): void {
    const u = T.untether;
    m.endSegment();
    this.stage = { kind: "collapsing", quadrant: q, airborne: this.stage.kind === "untether" };
    m.show({ kind: "danger-withdrawn", role: "slash", after: m.now });
    this.releaseVine(m, "lifted");
    m.boss.say(m.chance("shout", V.shoutChance) ? "Obliteration..." : "Run... It matters not...", T.shoutLasts.long);
    m.boss.play(SEQ.p3QuadrantDestroyIn);
    m.boss.spotanim(SPOT.collapseIn, "collapse");
    this.world.setCrumbling([q]);
    this.chat(m, "The quadrant begins to collapse! Jump across the stones!", "red");
    m.log({ kind: "collapse-started", at: m.now, quadrant: q });
    m.afterPhase(T.poseLoopAfter, (n) => {
      n.boss.hold(SEQ.p3QuadrantDestroyLoop);
      n.boss.spotanim(SPOT.collapseLoop, "collapse");
    });
    const tiles = quadrantTiles(q);
    const fallsIn = minus(u.gone, u.obliteration);
    for (let wait: Sourced<TickSpan> = T.collapseBurstEvery; wait.value < fallsIn.value; wait = plus(wait, T.collapseBurstEvery)) {
      m.afterPhase(wait, (n) => this.burst(n, tiles));
    }
    m.afterPhase(minus(u.escapeLine, u.obliteration), (n) => {
      n.boss.say(n.pick("shout", ESCAPE_LINES), T.shoutLasts.short);
      n.boss.play(SEQ.p3UnleashOut90);
      n.boss.spotanim(SPOT.collapseOut1, "collapse");
    });
    m.afterPhase(fallsIn, (n) => this.fall(n, q, tiles));
    m.afterPhase(minus(u.nextSegment, u.obliteration), (n) => {
      if (this.stage.kind === "over") return;
      n.boss.show(true);
      const here = quadrantOf(n.player.tile);
      this.startSegment(n, here && !this.world.destroyed.has(here) ? here : this.nearestStanding(q), "appear");
    });
  }

  private burst(m: P3Ctx<E>, tiles: readonly ATile[]): void {
    const from = nonEmpty(tiles);
    const looks = nonEmpty(SPOT.collapsingExplosion.value);
    if (from === null || looks === null) return;
    const bursts: { tile: ATile; id: number }[] = [];
    for (let i = 0; i < V.collapseBursts.value; i++) bursts.push({ tile: m.pick("burst-tile", from), id: m.pick("burst-look", looks) });
    m.show({ kind: "collapse-burst", bursts });
  }

  /** The quadrant goes. Standing on it is a death; the third fall hands the fight on. */
  private fall(m: P3Ctx<E>, q: Quadrant, tiles: readonly ATile[]): void {
    const onIt = quadrantOf(m.player.tile) === q && !(this.crossing?.started ?? false);
    this.world.removeFloor(tiles);
    this.world.destroy(q);
    this.world.setCrumbling([]);
    this.patches = this.patches.filter((p) => quadrantOf(p.tile) !== q);
    m.show({ kind: "patches-cleared", quadrant: q });
    this.rifts.forEach((r) => r.remove());
    this.rifts = [];
    m.boss.hold(null);
    m.boss.show(false);
    m.boss.targetable(false);
    const standing = QUADRANTS.filter((left) => !this.world.destroyed.has(left));
    m.log({ kind: "quadrant-fell", at: m.now, quadrant: q, standing });
    if (onIt) {
      this.stage = { kind: "over" };
      this.chat(m, "The void consumes you.", "red");
      this.world.fighter.setHp(0);
      m.log({ kind: "player-consumed", at: m.now, quadrant: q });
      return;
    }
    this.segment++;
    if (this.segment < V.hpFloors.value.length) {
      this.floorFraction = V.hpFloors.value[this.segment];
      this.stage = { kind: "between" };
      return;
    }
    this.stage = { kind: "over" };
    const [left] = standing;
    if (left === undefined) throw new Error("the third fall left no quadrant standing");
    const voids = this.patches.filter((p) => p.end.kind === "quadrant").map(({ tile, placed }) => ({ tile, placed }));
    this.fallen(m, { tick: m.now, standing: left, boss: { hp: m.boss.hp, defence: m.boss.defence }, voids });
  }

  private nearestStanding(from: Quadrant): Quadrant {
    for (const step of [-1, 1, 2]) {
      const q = clockwise(from, step);
      if (!this.world.destroyed.has(q)) return q;
    }
    return from;
  }

  private tick(m: P3Ctx<E>): void {
    this.patches = this.patches.filter((p) => p.end.kind === "quadrant" || p.end.tick > m.now);
    const patch = this.patches.find((p) => same(p.tile, m.player.tile));
    if (patch && (m.now - patch.placed) % T.patchEvery.value === 0) m.hit({ kind: "void-patch" }, V.patchDamage);
    this.stepCrossing(m);
    if (this.vine !== null) this.world.fighter.freeze(T.vineHolds.value);
    if (this.collapseDue(m)) return;
    if (this.stage.kind === "chain") this.chase(m);
  }

  /** Practice refills a living player and keeps prayer up; otherwise say why the prayers just went out. */
  private practice(m: P3Ctx<E>): void {
    const { fighter, practice } = this.world;
    const { hp, maxHp, prayer, maxPrayer } = fighter.stats;
    if (practice && hp > 0 && hp < V.practiceRefill.hitpoints.value) fighter.setHp(maxHp);
    if (practice && prayer < V.practiceRefill.prayer.value) fighter.setPrayer(maxPrayer);
    if (prayer <= 0 && this.prayerLeft > 0 && !practice) this.chat(m, "You have run out of Prayer points. Drink a super restore.", "game");
    this.prayerLeft = prayer;
  }

  /** He walks after you, inside his own quadrant. */
  private chase(m: P3Ctx<E>): void {
    if (this.inMelee(m)) return;
    const here = m.player.tile;
    if (quadrantOf(here) !== this.quadrant) return;
    const sw = m.boss.at;
    const centre = bodyCentre(this.body(m));
    const dx = sign(Math.round(here.x - centre.x));
    const dz = sign(Math.round(here.z - centre.z));
    for (const next of [at(sw.x + dx, sw.z + dz), at(sw.x + dx, sw.z), at(sw.x, sw.z + dz)]) {
      if (next.x === sw.x && next.z === sw.z) continue;
      if (covers({ sw: next, size: 3 }, here)) continue;
      let fits = true;
      for (let x = 0; x < 3 && fits; x++) {
        for (let z = 0; z < 3 && fits; z++) {
          const t = at(next.x + x, next.z + z);
          if (!this.world.isWalkable(t) || quadrantOf(t) !== this.quadrant) fits = false;
        }
      }
      if (fits) {
        m.boss.step(next);
        return;
      }
    }
  }

  private airborne(): boolean {
    return this.stage.kind === "untether" || (this.stage.kind === "collapsing" && this.stage.airborne);
  }

  private stepCrossing(m: P3Ctx<E>): void {
    const crossing = this.crossing;
    if (crossing === null) return;
    const { fighter } = this.world;
    if (!crossing.started && !same(m.player.tile, crossing.bank)) {
      if (!fighter.walking) this.clearCrossing(m);
      return;
    }
    const [next, ...rest] = crossing.jumps;
    fighter.jump(next, T.stoneJump.value);
    const [following, ...after] = rest;
    if (following === undefined) this.clearCrossing(m);
    else this.crossing = { ...crossing, jumps: [following, ...after], started: true };
  }

  private clearCrossing(m: P3Ctx<E>): void {
    this.crossing = null;
    m.show({ kind: "crossing-cleared" });
  }

  /** A click the phase answers itself: a censer in reach, or a stone or a tile across a chasm. */
  interceptWalk(to: ATile): boolean {
    const m = this.ctx;
    if (m === null) return false;
    if (this.crossing?.started ?? false) return true;
    for (const [q, censer] of this.world.censers) {
      if (reach(to, censer.tile) <= 1) {
        this.useCenser(m, q);
        return true;
      }
    }
    const from = quadrantOf(m.player.tile);
    if (from === null) return false;
    const stoneArm = ARMS.find((arm) => stonesOf(arm).some((s) => same(s, to)));
    let target: Quadrant | null = null;
    let arm: Arm | null = null;
    if (stoneArm) {
      arm = stoneArm;
      const [a, b] = quadrantsOfArm(stoneArm);
      target = from === a ? b : from === b ? a : null;
    } else {
      const dest = quadrantOf(to);
      if (dest && dest !== from) {
        arm = armBetween(from, dest);
        target = arm ? dest : null;
        if (!arm) {
          this.chat(m, "You can't jump that far; cross one chasm at a time.", "game");
          return true;
        }
      }
    }
    if (!arm || !target) {
      if (this.crossing !== null) this.clearCrossing(m);
      return false;
    }
    if (this.world.destroyed.has(target)) {
      this.chat(m, "There is nothing left over there.", "game");
      return true;
    }
    const stones = stonesOf(arm);
    const bank = bankBeside(stones[0], arm, from);
    const landing = bankBeside(stones[2], arm, target);
    const started = same(m.player.tile, bank);
    const jumps: Crossing["jumps"] = [stones[0], ...stones.slice(1), landing];
    this.crossing = { from, to: target, bank, jumps, started };
    m.show({ kind: "crossing", bank, hops: jumps });
    m.log({ kind: "crossing-started", at: m.now, from, to: target });
    if (!started) this.world.fighter.walkTo(bank);
    return true;
  }

  private useCenser(m: P3Ctx<E>, q: Quadrant): void {
    const censer = this.world.censers.get(q);
    if (!censer) return;
    if (censer.lit) {
      this.chat(m, "The censer has already been lit.", "game");
      return;
    }
    if (quadrantOf(m.player.tile) !== q) {
      this.chat(m, "You need to be in this quadrant to light its censer.", "game");
      return;
    }
    const { fighter } = this.world;
    this.world.lightCenser(q);
    this.playerSpot(m, GOD_GLOW[censer.god], "censer");
    this.chat(m, `You light the ${GOD_NAME[censer.god]} censer.`, "purple");
    m.log({ kind: "censer-lit", at: m.now, quadrant: q, god: censer.god });
    const c = V.censer;
    switch (censer.god) {
      case "bandos":
      case "armadyl":
        this.world.maxNextHit();
        this.chat(m, "Your next hit will be a maximum hit.", "purple");
        return;
      case "zaros":
        fighter.setSpecial(Math.min(c.specialMax.value, fighter.stats.special + c.special.value));
        return;
      case "saradomin":
        fighter.setHp(fighter.stats.hp + c.hitpoints.value);
        fighter.setPrayer(Math.min(fighter.stats.maxPrayer, fighter.stats.prayer + c.prayer.value));
        return;
      default: {
        const unhandled: never = censer.god;
        return unhandled;
      }
    }
  }

  /** The SDK's death screen, on the tick it shows. */
  lose(): void {
    const m = this.ctx;
    if (m === null || this.ending.kind === "lost") return;
    this.ending = { kind: "lost", at: m.now };
    this.chat(m, "Oh dear, you are dead!", "game");
    m.log({ kind: "player-died", at: m.now });
  }

  hpFloor(maxHp: number): number {
    return Math.ceil(maxHp * this.floorFraction);
  }

  /** Melee cannot reach him while he levitates. The refusal shows at most once in a few ticks. */
  playerAttacking(onBoss: boolean, style: Style): boolean {
    const m = this.ctx;
    if (!onBoss || style !== "melee" || !this.airborne() || m === null) return true;
    if (m.now - this.lastFlyingMessage >= T.flyingMessageEvery.value) {
      this.chat(m, "It's flying too high to hit using melee.", "game");
      this.lastFlyingMessage = m.now;
    }
    return false;
  }

  private chat(m: P3Ctx<E>, text: string, tone: Tone): void {
    m.show({ kind: "chat", text, tone });
  }

  private playerSpot(m: P3Ctx<E>, id: Sourced<number>, channel: string, raised = false): void {
    m.show({ kind: "player-spot", id: id.value, channel, raised });
  }
}
