import type { Tick } from "../../../../sim/brands";
import type { Entries } from "../../../../sim/encounter";
import type { Script } from "../../../../sim/script";
import { each, minus, plus } from "../../../../sim/sourced";
import type { ATile, Arm, Quadrant } from "../../fight/geometry";
import {
  ARMS,
  ARM_DIR,
  MIDDLE,
  QUADRANT_SIGN,
  ROOM_HALF,
  armsOf,
  at,
  clockwise,
  inRoom,
  key,
  quadrantOf,
  same,
  sideOf,
} from "../../fight/geometry";
import { seqSourced as SEQ, soundSourced as SOUND, spotSourced as SPOT } from "../data/looks";
import type { GapSequence } from "./data";
import { T, V } from "./data";
import type { MarkRole, P2Ctx, P2Entry, P2Outcome, P2Roll, P2Stage, P2Types } from "./types";
import type { P2World, Portal } from "./world";

/** Portals on one arm of the cross, nearest the middle first. */
const PORTALS_PER_ARM = 6;
/** Client cycles in a tick. The volley's reach is counted in these. */
const CYCLES_PER_TICK = 30;
/** Each arm's portal rotation, in quarter turns. */
const ROTATION: Readonly<Record<Arm, number>> = { N: 3, E: 0, S: 1, W: 2 };
/** The blade keeps three quarters of the pool. */
const HP_KEPT = 0.75;
/** He faces the south entrance. */
const FACING = at(0, 10);
const CENTRE = at(0, 0);

type Safe = Readonly<{ kind: "closed" }> | { kind: "open"; tile: ATile; left: "here" | "gone" };

type Round = {
  q: Quadrant;
  start: Tick;
  sequence: GapSequence;
  /** Waves lit so far this round: the next wave's index into the sequence. */
  waves: number;
  gaps: Map<Arm, number>;
  wave: "dark" | "lit";
  coverage: "gaps" | "all";
  pools: ATile[];
  safe: Safe;
};

type Wave = { line: ATile[]; spent: boolean };

function nonEmpty<T>(items: readonly T[]): readonly [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined) throw new Error("phase 2 had nothing to choose from");
  return [first, ...rest];
}

/** The two tiles of portal `index` (0 nearest the middle) on an arm. The cross runs along x = 0 and z = 0. */
function portalTiles(arm: Arm, index: number): readonly [ATile, ATile] {
  const { dx, dz } = ARM_DIR[arm];
  const n = 2 * index + 1;
  return [at(dx * n, dz * n), at(dx * (n + 1), dz * (n + 1))];
}

/** One row or column a portal fires into the quadrant, nearest first. The tile d out is line[d - 1]. */
function lineFrom(arm: Arm, origin: ATile, q: Quadrant): ATile[] {
  const { sx, sz } = QUADRANT_SIGN[q];
  const tiles: ATile[] = [];
  for (let d = 1; d <= ROOM_HALF + 1; d++) {
    const t = arm === "N" || arm === "S" ? at(origin.x + sx * d, origin.z) : at(origin.x, origin.z + sz * d);
    if (!inRoom(t)) return tiles;
    tiles.push(t);
  }
  return tiles;
}

/**
 * The tick, counted from the firing tick, on which a volley is over the tile d out.
 * Tiles 1-5 the firing tick, 6-10 the next, 11-12 the one after, at 6 cycles a tile.
 * Stand 6 out and click 4 out one tick before the volley, and it misses on both ticks.
 */
function reachTick(d: number, cyclesPerTile: number): number {
  return Math.floor((cyclesPerTile * d - cyclesPerTile) / CYCLES_PER_TICK);
}

/** Phase 2 written as closures: the blade, the portal cross, and three rounds. */
export class P2Script<E extends Entries> implements Script<E, P2Types> {
  private mode: "arriving" | "open" | "enough" = "arriving";
  private round: Round | null = null;
  private portals: readonly Portal[] = [];
  private roundsRun = 0;
  private firstQuadrant: Quadrant | null = null;
  private firstSequence: number | null = null;
  private ending: P2Outcome = { kind: "running" };
  private ctx: P2Ctx<E> | null = null;

  constructor(
    private readonly world: P2World,
    private readonly entry: P2Entry,
    private readonly intoP3: (m: P2Ctx<E>) => void,
  ) {}

  get current(): P2Stage {
    switch (this.mode) {
      case "arriving":
        return { kind: "arriving" };
      case "open":
        return { kind: "open" };
      case "enough":
        return { kind: "enough" };
      default: {
        const unhandled: never = this.mode;
        return unhandled;
      }
    }
  }

  get outcome(): P2Outcome {
    return this.ending;
  }

  begin(m: P2Ctx<E>): void {
    this.ctx = m;
    this.mode = "open";
    m.boss.targetable(false);
    m.boss.faceTile(FACING);
    m.boss.play(SEQ.p2Transformation);
    m.boss.spotanim(SPOT.p1ToP2, "transform");
    if (this.entry.kind === "opening") this.chat(m, "Challenge started: Ocellus.", "game");
    m.afterPhase(T.portalsAt, (n) => this.raise(n));
    m.afterPhase(T.bladeAt, (n) => this.wake(n));
    for (const atRound of each(T.rounds)) m.afterPhase(atRound, (n) => this.startRound(n));
    m.afterPhase(T.enough, (n) => this.enough(n));
    m.afterPhase(plus(T.enough, T.oneTick), (n) => this.collapse(n));
    m.afterPhase(minus(T.p3At, T.oneTick), (n) => this.leave(n));
    this.repair(m);
  }

  each(m: P2Ctx<E>): void {
    this.ctx = m;
    const round = this.round;
    if (this.mode !== "open" || round === null) return;
    const offset = m.now - round.start;
    const here = m.player.tile;
    const safe = round.safe;
    const escapeFrom = T.safePortalAt.value + T.oneTick.value;
    if (safe.kind === "open" && safe.left === "here" && offset >= escapeFrom && offset <= T.safePortalUntil.value && same(here, safe.tile)) {
      safe.left = "gone";
      const landing = m.pick("escape-tile", nonEmpty(this.poolTiles(clockwise(round.q))));
      this.world.fighter.teleport(landing);
      m.show({ kind: "player-spot", id: SPOT.safePortalDespawn.value, channel: "portal" });
      m.log({ kind: "escaped", at: m.now, to: landing });
      return;
    }
  }

  landed(): void {}

  /** The SDK's death screen, on the tick it shows. */
  lose(): void {
    const m = this.ctx;
    if (m === null || this.ending.kind === "lost") return;
    this.ending = { kind: "lost", at: m.now };
    this.chat(m, "Oh dear, you are dead!", "game");
    m.log({ kind: "player-died", at: m.now });
  }

  hpFloor(maxHp: number): number {
    return Math.ceil(maxHp * HP_KEPT);
  }

  playerAttacking(): boolean {
    return true;
  }

  interceptWalk(_to: ATile): boolean {
    return false;
  }

  private chat(m: P2Ctx<E>, text: string, tone: "game" | "purple"): void {
    m.show({ kind: "chat", text, tone });
  }

  /** The repair graphic from tick 3, then every 3, and not at enough. */
  private repair(m: P2Ctx<E>): void {
    if (m.now + T.repairEvery.value >= T.enough.value) return;
    m.afterPhase(T.repairEvery, (n) => {
      n.show({ kind: "ground", effect: "repair", tiles: [CENTRE] });
      this.repair(n);
    });
  }

  private raise(m: P2Ctx<E>): void {
    const portals: Portal[] = [];
    for (const arm of ARMS) {
      for (let index = 0; index < PORTALS_PER_ARM; index++) portals.push({ arm, index, tiles: portalTiles(arm, index) });
    }
    this.portals = portals;
    this.world.raise(portals);
    const here = m.player.tile;
    const onWall = portals.some((portal) => portal.tiles.some((tile) => same(tile, here)));
    if (onWall) {
      const { sx, sz } = QUADRANT_SIGN[sideOf(here)];
      this.world.fighter.hop(at(here.x === 0 ? sx : here.x, here.z === 0 ? sz : here.z));
    }
    m.log({ kind: "portals-rose", at: m.now });
    this.paint(m);
  }

  private wake(m: P2Ctx<E>): void {
    m.boss.say("Your time... comes...", T.shoutLasts);
    m.boss.targetable(true);
    this.chat(m, "The Blade can now be attacked.", "purple");
    m.log({ kind: "blade-woke", at: m.now });
  }

  private startRound(m: P2Ctx<E>): void {
    const here = quadrantOf(m.player.tile) ?? sideOf(m.player.tile);
    const q = this.firstQuadrant === null ? here : clockwise(this.firstQuadrant, this.roundsRun);
    if (this.firstQuadrant === null) this.firstQuadrant = q;
    this.firstSequence ??= V.gapOrder.value.indexOf(m.pick("gap-sequence", V.gapOrder.value));
    const sequence = V.gapOrder.value[(this.firstSequence + this.roundsRun) % V.gapOrder.value.length];
    this.roundsRun += 1;
    const last = this.roundsRun === T.rounds.value.length;
    const round: Round = { q, start: m.now, sequence, waves: 0, gaps: new Map(), wave: "dark", coverage: "gaps", pools: [], safe: { kind: "closed" } };
    this.round = round;
    this.arm(m, round, 0, last);
    if (last) return;
    m.afterPhase(T.poolsAt, (n) => this.spawnPools(n, round));
    m.afterPhase(T.allLitAt, (n) => this.lightAll(n, round));
    m.afterPhase(T.safePortalAt, (n) => this.openSafe(n, round));
    m.afterPhase(plus(T.safePortalAt, T.oneTick), (n) => this.discharge(n, round));
    m.afterPhase(plus(T.safePortalAt, plus(T.oneTick, T.oneTick)), (n) => this.boom(n, round));
    m.afterPhase(T.allFireAt, (n) => this.fire(n, round, true));
  }

  /** Six lights, the first now, then every lightEvery. The last round lights none that would fall at enough or later. */
  private arm(m: P2Ctx<E>, round: Round, k: number, last: boolean): void {
    if (k >= V.lightTimes.value) return;
    if (this.round !== round) return;
    if (last && m.now >= T.enough.value) return;
    this.light(m, round);
    m.afterPhase(T.fireAfterLight, (n) => this.fire(n, round, false));
    m.afterPhase(T.lightEvery, (n) => this.arm(n, round, k + 1, last));
  }

  /**
   * Ten of the twelve portals light, a gap on each arm. The gaps' rows and columns cross on the safe 2x2.
   * The gaps are the round's sequence, wave by wave.
   */
  private light(m: P2Ctx<E>, round: Round): void {
    const gaps = V.gapSequences[round.sequence].value[round.waves];
    if (gaps === undefined) throw new Error(`phase 2 lit a seventh wave of ${round.sequence}`);
    const [northSouth, eastWest] = gaps;
    round.waves += 1;
    for (const arm of armsOf(round.q)) round.gaps.set(arm, (arm === "N" || arm === "S" ? northSouth : eastWest) - 1);
    round.wave = "lit";
    m.log({ kind: "portals-lit", at: m.now });
    this.paint(m);
  }

  private lightAll(m: P2Ctx<E>, round: Round): void {
    if (this.round !== round) return;
    round.coverage = "all";
    round.wave = "lit";
    m.log({ kind: "portals-lit", at: m.now });
    this.paint(m);
  }

  private litPortals(round: Round): readonly Portal[] {
    const [a, b] = armsOf(round.q);
    return this.portals.filter((portal) => (portal.arm === a || portal.arm === b) && (round.coverage === "all" || round.gaps.get(portal.arm) !== portal.index));
  }

  private fire(m: P2Ctx<E>, round: Round, crossfire: boolean): void {
    if (this.round !== round || round.wave !== "lit") return;
    const speed = crossfire ? V.crossfireCyclesPerTile.value : V.lineCyclesPerTile.value;
    const waves: Wave[] = [];
    for (const portal of this.litPortals(round)) {
      for (const origin of portal.tiles) {
        const line = lineFrom(portal.arm, origin, round.q);
        const far = line[line.length - 1];
        if (far === undefined) continue;
        this.world.shoot(portal.tiles[0], far, reachTick(line.length, speed) + 1, speed * line.length - speed);
        waves.push({ line, spent: false });
      }
    }
    const last = waves.reduce((furthest, wave) => Math.max(furthest, reachTick(wave.line.length, speed)), 0);
    m.log({ kind: "volley", at: m.now, crossfire, speed, lines: waves.map((wave) => wave.line) });
    this.judge(m, waves, speed, 0, last);
    round.wave = "dark";
    if (crossfire) {
      this.round = null;
      round.pools = [];
      round.safe = { kind: "closed" };
    }
    this.paint(m);
  }

  /** Each line is judged once, on the tick the wave is over the tile the player stands on. */
  private judge(m: P2Ctx<E>, waves: readonly Wave[], speed: number, k: number, last: number): void {
    const here = m.player.tile;
    for (const wave of waves) {
      const d = wave.line.findIndex((tile) => same(tile, here)) + 1;
      if (wave.spent || d === 0 || reachTick(d, speed) !== k) continue;
      wave.spent = true;
      m.hit({ kind: "line" }, V.lineDamage);
    }
    if (k < last) m.afterPhase(T.oneTick, (n) => this.judge(n, waves, speed, k + 1, last));
  }

  private spawnPools(m: P2Ctx<E>, round: Round): void {
    if (this.round !== round) return;
    const candidates = this.world.hasFloor(CENTRE) ? this.poolTiles(round.q) : [];
    round.pools = this.draw(m, candidates, V.poolCount.value, "pool-tile");
    m.show({ kind: "ground", effect: "pools", tiles: round.pools });
    m.log({ kind: "pools-opened", at: m.now, count: round.pools.length });
    this.paint(m);
    m.afterPhase(T.poolsLast, (n) => {
      if (this.round !== round) return;
      round.pools = [];
      this.paint(n);
    });
  }

  private openSafe(m: P2Ctx<E>, round: Round): void {
    if (this.round !== round) return;
    const tiles = round.pools.length > 0 ? round.pools : this.poolTiles(round.q);
    const tile = m.pick("safe-tile", nonEmpty(tiles));
    round.safe = { kind: "open", tile, left: "here" };
    m.show({ kind: "ground", effect: "safe-spawn", tiles: [tile] });
    m.log({ kind: "safe-opened", at: m.now, tile });
    this.paint(m);
    const openFor = minus(T.safePortalUntil, T.safePortalAt);
    m.afterPhase(T.oneTick, (n) => n.show({ kind: "ground", effect: "safe-idle", tiles: [tile] }));
    m.afterPhase(plus(openFor, T.oneTick), (n) => n.show({ kind: "ground", effect: "safe-despawn", tiles: [tile] }));
  }

  private discharge(m: P2Ctx<E>, round: Round): void {
    if (this.round !== round) return;
    m.boss.spotanim(SPOT.swordDischarge, "discharge");
    m.show({ kind: "sound", id: SOUND.swordDischarge.value, at: MIDDLE });
  }

  private boom(m: P2Ctx<E>, round: Round): void {
    if (this.round !== round) return;
    m.show({ kind: "sound", id: SOUND.swordDropBoom.value, at: MIDDLE });
  }

  private poolTiles(q: Quadrant): ATile[] {
    const { sx, sz } = QUADRANT_SIGN[q];
    const tiles: ATile[] = [];
    for (let x = 1; x <= ROOM_HALF; x++) {
      for (let z = 1; z <= ROOM_HALF; z++) {
        const t = at(x * sx, z * sz);
        const centre = Math.abs(t.x) <= 1 && Math.abs(t.z) <= 1;
        if (inRoom(t) && !centre && this.world.isWalkable(t)) tiles.push(t);
      }
    }
    return tiles;
  }

  private draw(m: P2Ctx<E>, tiles: readonly ATile[], count: number, stream: P2Roll): ATile[] {
    const bag = [...tiles];
    const drawn: ATile[] = [];
    while (drawn.length < count && bag.length > 0) {
      const choice = m.pick(stream, nonEmpty(bag));
      drawn.push(choice);
      const index = bag.findIndex((tile) => same(tile, choice));
      if (index >= 0) bag.splice(index, 1);
    }
    return drawn;
  }

  private enough(m: P2Ctx<E>): void {
    this.mode = "enough";
    this.round = null;
    m.boss.targetable(false);
    this.world.release();
    m.boss.say("This... is enough...", T.shoutLasts);
    m.boss.play(SEQ.p2ToP3Part1);
    m.boss.spotanim(SPOT.p2ToP3ArmGlow, "arm-glow");
    m.boss.spotanim(SPOT.p2ToP3Arm, "arm");
    m.show({ kind: "ground", effect: "sword-drop", tiles: [CENTRE] });
    m.show({ kind: "sound", id: SOUND.swordDischarge.value, at: MIDDLE });
    m.log({ kind: "enough", at: m.now });
    this.paint(m);
  }

  private collapse(m: P2Ctx<E>): void {
    m.show({ kind: "sound", id: SOUND.swordDropBoom.value, at: MIDDLE });
    m.show({ kind: "ground", effect: "sword-explosion", tiles: [CENTRE] });
  }

  /**
   * Asked one tick before p3At: the director enters phase 3 on the next tick, which is his p3At.
   * The blade plays the second half of the change on this tick, the last one it is still here for.
   */
  private leave(m: P2Ctx<E>): void {
    if (this.ending.kind === "lost") return;
    m.boss.play(SEQ.p2ToP3Part2);
    m.log({ kind: "leaving", at: m.now });
    this.intoP3(m);
  }

  private paint(m: P2Ctx<E>): void {
    const round = this.round;
    const lit = new Set(round !== null && round.wave === "lit" ? this.litPortals(round) : []);
    m.show({
      kind: "portals",
      faces: this.portals.map((portal) => ({ tiles: portal.tiles, rotation: ROTATION[portal.arm], lit: lit.has(portal) })),
    });
    m.show({ kind: "marks", tiles: round === null ? [] : this.marks(round) });
  }

  private marks(round: Round): Readonly<{ tile: ATile; role: MarkRole }>[] {
    const marks: { tile: ATile; role: MarkRole }[] = [];
    if (round.wave === "lit") {
      const hits = new Map<string, number>();
      const tiles = new Map<string, ATile>();
      for (const portal of this.litPortals(round)) {
        for (const origin of portal.tiles) {
          for (const tile of lineFrom(portal.arm, origin, round.q)) {
            const id = key(tile);
            hits.set(id, (hits.get(id) ?? 0) + 1);
            tiles.set(id, tile);
          }
        }
      }
      for (const [id, count] of hits) {
        const tile = tiles.get(id);
        if (tile !== undefined && this.world.isWalkable(tile)) marks.push({ tile, role: count > 1 ? "cross" : "wave" });
      }
      for (const tile of this.poolTiles(round.q)) {
        if (!hits.has(key(tile))) marks.push({ tile, role: "lane" });
      }
    }
    for (const tile of round.pools) marks.push({ tile, role: "pool" });
    if (round.safe.kind === "open") marks.push({ tile: round.safe.tile, role: "escape" });
    return marks;
  }
}
