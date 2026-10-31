import { tick } from "../../../../sim/brands";
import type { Tick } from "../../../../sim/brands";
import type { Entries, Enter } from "../../../../sim/encounter";
import type { Script } from "../../../../sim/script";
import type { Sourced } from "../../../../sim/sourced";
import { each, minus, plus } from "../../../../sim/sourced";
import type { TickSpan } from "../../../../sim/brands";
import type { ATile, Body, Quadrant } from "../../fight/geometry";
import { CORNERS, MIDDLE, QUADRANTS, at, bodyCentre, clockwise, distanceToBody, inRoom, reach, ringAround, same, sign } from "../../fight/geometry";
import { formatTicks } from "../options";
import { seqSourced as SEQ, soundSourced as SOUND, spotSourced as SPOT } from "../data/looks";
import { T, V, upTo } from "./data";
import type { Element, P1Cause, P1Ctx, P1Outcome, P1Stage, Side, Tendril, P1Types } from "./types";
import type { P1World } from "./world";

const INTRO = "Now... ascension...";
const CHALLENGE = "Challenge started: Ocellus.";
const ENDING_LINE = "You... will disappear...";
/** His strike's shout by shot count: up to 2 "Death... awaits...", 3 "Eradicate..." (ten raid logs); more is unrecorded. */
const STRIKE_ONE = "Death... awaits...";
const STRIKE_THREE = "Eradicate...";
const STRIKE_MANY = "Embrace... annihilation...";
const PLAYER = at(0, -9);
const FACE_IN = at(0, 2);
const FACE_OUT = at(0, 10);
const CENTRE = at(0, 0);
const SIDES = ["east", "south", "west", "north"] as const;
const BODY = 3;

type Line = { tiles: readonly ATile[]; growth: Readonly<{ dx: number; dz: number }>; closed: boolean };

function nonEmpty<T>(items: readonly T[]): readonly [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined) throw new Error("phase 1 had nothing to choose from");
  return [first, ...rest];
}

function pair(list: readonly Sourced<TickSpan>[]): readonly [Sourced<TickSpan>, Sourced<TickSpan>] {
  const [first, second] = list;
  if (first === undefined || second === undefined) throw new Error("phase 1's beat closes are not a pair");
  return [first, second];
}

/**
 * Phase 1 written as closures. Segment timers are the corner and the middle: a kill drops them.
 * The ending teleport is on the phase scope, so it still runs, and it asks for phase 2 one tick
 * before the old enter, because the director arrives the tick after it is asked.
 */
export class P1Script<E extends Entries> implements Script<E, P1Types> {
  meter = 0;
  /** Cracks that have chipped you since you were last healed for them. */
  private chipsOwed = 0;
  private element: Element = "fire";
  private stage: P1Stage = { kind: "arriving" };
  private ending = false;
  private outcomeState: P1Outcome = { kind: "running" };
  private thresholds: number[] = [...V.thresholds.value];
  private lines: Line[] = [];
  private blastBody: Body | null = null;
  private ctx: P1Ctx<E> | null = null;

  constructor(
    private readonly world: P1World,
    private readonly intoP2: (from: number) => Enter<E>,
    private readonly tell: (text: string, at: number) => void,
    private readonly changed: () => void,
  ) {}

  get outcome(): P1Outcome {
    return this.outcomeState;
  }

  get ended(): boolean {
    return this.ending;
  }

  get current(): P1Stage {
    return this.stage;
  }

  hpFloor(): number {
    return 0;
  }

  begin(m: P1Ctx<E>): void {
    this.ctx = m;
    this.element = m.chance("opening-element", V.coin) ? "fire" : "water";
    this.world.claim();
    m.boss.show(true);
    m.boss.faceTile(FACE_IN);
    m.boss.say(INTRO, T.introLasts);
    this.chat(m, CHALLENGE);
    this.world.fighter.hop(PLAYER);
    m.log({ kind: "opened", at: m.now });
    m.after(T.oneTick, (n) => this.reveal(n));
    m.after(T.startWalkAfter, (n) => this.startWalk(n, n.pick("first-corner", nonEmpty(QUADRANTS))));
  }

  each(m: P1Ctx<E>): void {
    this.ctx = m;
    if (!this.ending && this.world.revealed() && m.boss.hp <= 0) this.fell(m);
    this.step(m);
  }

  landed(m: P1Ctx<E>, cause: P1Types["cause"]): void {
    if (cause.kind !== "volley") return;
    const id = cause.element === "fire" ? SPOT.fireImpact.value : SPOT.waterImpact.value;
    m.show({ kind: "player-spot", id });
  }

  lose(): void {
    this.finish("lost", "Oh dear, you are dead!", "player-died");
  }

  win(): void {
    const at = this.ctx?.now ?? tick(0);
    if (this.outcomeState.kind !== "running") return;
    this.outcomeState = { kind: "won", at };
    this.tell(`Challenge complete: Ocellus. Duration: ${formatTicks(at)}`, at);
    this.changed();
  }

  /** His HP reached 0. Segment timers die here; the teleport to the middle, then phase 2, does not. */
  fell(m: P1Ctx<E>): void {
    if (this.ending) return;
    this.ending = true;
    this.stage = { kind: "ending" };
    this.ctx = m;
    m.endSegment();
    this.lines = [];
    this.blastBody = null;
    m.show({ kind: "clear-cracks" });
    m.show({ kind: "blast-clear" });
    m.boss.targetable(false);
    m.boss.overhead(null);
    m.boss.say(ENDING_LINE, T.introLasts);
    m.log({ kind: "ending", at: m.now });
    const atMiddle = same(m.boss.at, MIDDLE);
    const lands = plus(T.endingTeleportAfter, T.endingLandAfter);
    if (!atMiddle) {
      m.afterPhase(T.endingTeleportAfter, (n) => {
        n.boss.play(SEQ.p1TeleportOut);
        n.boss.spotanim(SPOT.p1TeleportOut, "teleport");
      });
      m.afterPhase(plus(T.endingTeleportAfter, T.oneTick), (n) => n.boss.show(false));
      m.afterPhase(minus(lands, T.oneTick), (n) => n.boss.place(MIDDLE));
      m.afterPhase(lands, (n) => this.land(n));
    }
    const landed = atMiddle ? T.transformAtMiddleAfter : plus(lands, T.endingTransformAfterLanding);
    const leave = plus(landed, minus(T.p2After, T.oneTick));
    m.afterPhase(landed, (n) => {
      n.boss.play(SEQ.p1Transformation);
      n.boss.spotanim(SPOT.p1ToP2, "transform");
    });
    m.afterPhase(leave, (n) => {
      n.log({ kind: "leaving", at: n.now });
      n.next(this.intoP2(n.now + 1));
    });
  }

  private finish(kind: "lost", text: string, event: "player-died"): void {
    if (this.outcomeState.kind !== "running") return;
    const at = this.ctx?.now ?? tick(0);
    this.outcomeState = { kind, at };
    this.tell(text, at);
    this.ctx?.log({ kind: event, at });
    this.changed();
  }

  private chat(m: P1Ctx<E>, text: string): void {
    m.show({ kind: "chat", text });
  }

  private reveal(m: P1Ctx<E>): void {
    if (this.ending) return;
    this.world.reveal();
    m.boss.faceTile(FACE_IN);
    m.boss.targetable(true);
    m.log({ kind: "revealed", at: m.now });
  }

  private land(m: P1Ctx<E>): void {
    m.boss.show(true);
    m.boss.play(SEQ.p1TeleportIn);
    m.boss.spotanim(SPOT.p1TeleportIn, "teleport");
    m.boss.faceTile(FACE_OUT);
  }

  private step(m: P1Ctx<E>): void {
    const stage = this.stage;
    switch (stage.kind) {
      case "walking":
        this.walk(m, stage);
        return;
      case "arriving":
      case "corner":
      case "middle":
      case "ending":
        return;
      default: {
        const unhandled: never = stage;
        return unhandled;
      }
    }
  }

  private walk(m: P1Ctx<E>, stage: Extract<P1Stage, { kind: "walking" }>): void {
    const target = CORNERS[stage.to];
    const here = m.boss.at;
    if (!same(here, target)) {
      m.boss.step(at(here.x + sign(target.x - here.x), here.z + sign(target.z - here.z)));
      if (same(m.boss.at, target)) stage.arrivedAt = m.now;
    }
    if (stage.volleys && (m.now - stage.startedAt) % T.volleyEvery.value === 0) this.volleyTick(m, stage);
  }

  private startWalk(m: P1Ctx<E>, to: Quadrant): void {
    if (this.ending) return;
    this.world.releaseFace();
    this.stage = { kind: "walking", to, startedAt: m.now, arrivedAt: null, volleys: true };
  }

  private volleyTick(m: P1Ctx<E>, stage: Extract<P1Stage, { kind: "walking" }>): void {
    if (this.crossed(m)) {
      this.stage = { kind: "arriving" };
      this.startMiddle(m, stage.to);
      return;
    }
    const remaining = reach(m.boss.at, CORNERS[stage.to]);
    if (stage.arrivedAt !== null && stage.arrivedAt < m.now) {
      stage.volleys = false;
      m.boss.play(SEQ.p1VolleyEnd);
      m.boss.overhead(null);
      this.arrive(m, stage.to, T.oneTick);
      return;
    }
    if (m.now === stage.startedAt) m.boss.overhead("protect-melee");
    const arriving = remaining <= 1;
    this.volley(m, arriving ? SEQ.p1VolleyEnd : SEQ.p1VolleyStart);
    if (arriving) {
      stage.volleys = false;
      this.arrive(m, stage.to, T.chargeAfterArriving);
    }
  }

  private volley(m: P1Ctx<E>, seq: Sourced<number>): void {
    if (m.chance("element", V.elementSwitchChance)) this.element = this.element === "fire" ? "water" : "fire";
    const element = this.element;
    const style = element === "fire" ? "ranged" : "magic";
    m.boss.play(seq);
    m.boss.spotanim(element === "fire" ? SPOT.fireOnBoss : SPOT.waterOnBoss, "volley");
    const near = distanceToBody(this.body(m), m.player.tile) <= V.volleyLand.nearWithin.value;
    const delay = near ? T.volleyNear : T.volleyFar;
    m.show({ kind: "projectile", element, near, flight: delay.value });
    m.log({ kind: "volley", at: m.now, element });
    m.after(delay, (n) => n.hitPrayable({ kind: "volley", element }, style, V.volleyDamage));
  }

  private crossed(m: P1Ctx<E>): boolean {
    const next = this.thresholds[0];
    if (next === undefined) return false;
    return m.boss.hp <= Math.floor(m.boss.maxHp * next);
  }

  private arrive(m: P1Ctx<E>, q: Quadrant, chargeWait: Sourced<TickSpan>): void {
    m.log({ kind: "arrived", at: m.now, corner: q });
    m.boss.faceTile(CENTRE);
    if (chargeWait.value === T.oneTick.value) {
      m.after(T.oneTick, (n) => {
        n.boss.overhead(null);
        n.boss.faceTile(CENTRE);
        this.charge(n, q);
      });
      return;
    }
    m.after(minus(chargeWait, T.oneTick), (n) => {
      n.boss.overhead(null);
      n.boss.faceTile(CENTRE);
    });
    m.after(chargeWait, (n) => this.charge(n, q));
  }

  private charge(m: P1Ctx<E>, q: Quadrant): void {
    if (this.ending) return;
    this.stage = { kind: "corner", at: q };
    m.boss.play(SEQ.p1Charge);
    m.log({ kind: "charged", at: m.now, corner: q });
    const order = this.tendrilOrder(m, q);
    this.cornerLine(m, order[0]);
    let wait: Sourced<TickSpan> = T.linesEvery;
    for (let i = 1; i < V.lineCount.value; i++) {
      const due = wait;
      const tendril = order[i % 3];
      if (tendril !== undefined) m.after(due, (n) => this.cornerLine(n, tendril));
      wait = plus(wait, T.linesEvery);
    }
    let graphic: Sourced<TickSpan> = T.chargeVfxFrom;
    while (graphic.value < T.explodeAt.value) {
      const due = graphic;
      m.after(due, (n) => n.boss.spotanim(SPOT.p1Charge, "charge"));
      graphic = plus(graphic, T.chargeVfxEvery);
    }
    m.after(T.shoutAt, (n) => {
      n.boss.say(n.pick("shout", nonEmpty(V.shouts.value)), T.cornerShoutLasts);
      this.markBlast(n);
    });
    m.after(T.explodeAt, (n) => this.explode(n));
    m.after(T.blastAt, (n) => {
      this.blast(n);
      if (this.ending) return;
      const next = this.pickNext(n, q);
      if (this.crossed(n)) {
        this.startMiddle(n, next);
        return;
      }
      n.after(minus(T.walkOnAt, T.blastAt), (w) => this.startWalk(w, next));
    });
  }

  private tendrilOrder(m: P1Ctx<E>, q: Quadrant): readonly [Tendril, Tendril, Tendril] {
    const first: Tendril = q === "NE" || q === "SW" ? "z" : "x";
    const other: Tendril = first === "x" ? "z" : "x";
    return m.chance("tendril-order", V.coin) ? [first, "corner", other] : [first, other, "corner"];
  }

  private pickNext(m: P1Ctx<E>, from: Quadrant): Quadrant {
    const anti = V.routeWeights.anticlockwise.value;
    const cw = V.routeWeights.clockwise.value;
    const across = V.routeWeights.across.value;
    const rolled = m.roll("route", upTo(V.routeWeights.anticlockwise, anti + cw + across - 1));
    if (rolled < anti) return clockwise(from, -1);
    if (rolled < anti + cw) return clockwise(from, 1);
    return clockwise(from, 2);
  }

  private cornerLine(m: P1Ctx<E>, tendril: Tendril): void {
    if (this.ending) return;
    const sw = m.boss.at;
    const centre = bodyCentre({ sw, size: BODY });
    const ix = sign(-centre.x) || 1;
    const iz = sign(-centre.z) || 1;
    const innerX = ix < 0 ? sw.x : sw.x + 2;
    const innerZ = iz < 0 ? sw.z : sw.z + 2;
    let start: ATile;
    let dir: { dx: number; dz: number };
    if (tendril === "corner") {
      const rolled = m.roll("corner-tendril", upTo(V.cornerTendrilOutOf, V.cornerTendrilOutOf.value - 1));
      if (rolled < V.cornerTendrilDiagonal.value) {
        start = at(innerX + ix, innerZ + iz);
        dir = { dx: ix, dz: iz };
      } else if (rolled < V.cornerTendrilSide.value) {
        start = at(innerX + ix, innerZ);
        dir = { dx: ix, dz: 0 };
      } else {
        start = at(innerX, innerZ + iz);
        dir = { dx: 0, dz: iz };
      }
    } else {
      const straight = m.chance("straight", V.straightChance);
      if (tendril === "x") {
        start = straight ? at(innerX + ix, sw.z + 1) : at(innerX + ix, innerZ);
        dir = straight ? { dx: ix, dz: 0 } : { dx: ix, dz: iz };
      } else {
        start = straight ? at(sw.x + 1, innerZ + iz) : at(innerX, innerZ + iz);
        dir = straight ? { dx: 0, dz: iz } : { dx: ix, dz: iz };
      }
    }
    this.addLine(m, start, dir, V.cornerLineLength.value, T.lineClosesAfter);
  }

  private addLine(m: P1Ctx<E>, start: ATile, dir: Readonly<{ dx: number; dz: number }>, length: number, closesAfter: Sourced<TickSpan>): void {
    const tiles: ATile[] = [];
    for (let k = 0; k < length; k++) {
      const tile = at(start.x + dir.dx * k, start.z + dir.dz * k);
      if (!inRoom(tile) || !this.world.isFloor(tile)) break;
      tiles.push(tile);
    }
    if (tiles.length === 0) return;
    const growth = { dx: -dir.dx, dz: -dir.dz };
    const line: Line = { tiles, growth, closed: false };
    this.lines.push(line);
    m.show({ kind: "cracks", tiles, growth, closesAfter: closesAfter.value });
    m.log({ kind: "cracks", at: m.now, count: tiles.length });
    m.after(closesAfter, (n) => this.closeLine(n, line));
  }

  private closeLine(m: P1Ctx<E>, line: Line): void {
    if (line.closed || this.ending) return;
    line.closed = true;
    this.lines = this.lines.filter((open) => open !== line);
    m.show({ kind: "cracks-end", tiles: line.tiles, growth: line.growth });
    m.hit({ kind: "crack" }, V.closeChip);
    this.chipsOwed++;
    const blocked = line.tiles.some((tile) => same(tile, m.player.tile));
    if (blocked) {
      this.payBack(m, { kind: "block" });
      return;
    }
    this.meter = Math.min(V.meterMax.value, this.meter + V.meterPerLine.value);
    m.heal({ kind: "line" }, V.healPerLine.value, "boss");
    m.show({ kind: "sound", id: m.pick("crack-sound", nonEmpty(SOUND.crackClosed.value)), at: m.boss.at });
  }

  /**
   * A block, or the heal before his strike, gives back a chip's worth for each crack that has chipped you since: one
   * chip owed healed 3 to 6, two mostly 7 to 10, three mostly 11 to 14, in 574 of 697 heals in ten raid logs.
   */
  private payBack(m: P1Ctx<E>, cause: Extract<P1Cause, { kind: "block" | "strike-open" }>): void {
    let amount = 0;
    for (let i = 0; i < this.chipsOwed; i++) amount += m.roll(cause.kind, V.closeChip);
    this.chipsOwed = 0;
    if (amount > 0) m.heal(cause, amount, "player");
  }

  private explode(m: P1Ctx<E>): void {
    if (this.ending) return;
    m.boss.play(SEQ.p1Explode);
    m.boss.spotanim(SPOT.p1ExplodeOnBoss, "explode");
    this.markBlast(m);
    m.log({ kind: "exploded", at: m.now });
  }

  private markBlast(m: P1Ctx<E>): void {
    const body = this.body(m);
    this.blastBody = body;
    m.show({ kind: "blast-mark", tiles: [1, 2].flatMap((ring) => ringAround(body, ring)) });
  }

  private blast(m: P1Ctx<E>): void {
    if (this.ending) return;
    const body = this.blastBody ?? this.body(m);
    this.blastBody = null;
    m.show({ kind: "blast-clear" });
    const spots: { tile: ATile; id: number; delay: number }[] = [];
    [1, 2].forEach((ring, index) => {
      for (const tile of ringAround(body, ring)) {
        if (!this.world.isFloor(tile)) continue;
        spots.push({ tile, id: m.pick("blast-graphic", nonEmpty(SPOT.p1ExplodeFloor.value)), delay: index * 2 });
      }
    });
    m.show({ kind: "floor-spots", spots });
    m.log({ kind: "blasted", at: m.now });
    if (distanceToBody(body, m.player.tile) <= V.blastRadius.value) m.hit({ kind: "blast" }, V.blastDamage);
  }

  private startMiddle(m: P1Ctx<E>, next: Quadrant): void {
    if (this.ending) return;
    this.thresholds.shift();
    this.stage = { kind: "middle", next };
    m.boss.overhead(null);
    m.boss.targetable(false);
    m.boss.play(SEQ.p1TeleportOut);
    m.boss.spotanim(SPOT.p1TeleportOut, "teleport");
    m.log({ kind: "middle", at: m.now });
    m.after(T.oneTick, (n) => n.boss.show(false));
    m.after(T.teleportInAfter, (n) => {
      n.boss.place(MIDDLE);
      n.boss.show(true);
      n.boss.targetable(true);
      n.boss.play(SEQ.p1TeleportIn);
      n.boss.spotanim(SPOT.p1TeleportIn, "teleport");
    });
    const start = SIDES.indexOf(m.pick("side", SIDES));
    if (start < 0) throw new Error("phase 1 picked a side it does not have");
    let atBeat: Sourced<TickSpan> = T.firstBeatAfter;
    for (let beat = 0; beat < V.beats.value; beat++) {
      const due = atBeat;
      const side = SIDES[(start + beat) % SIDES.length];
      if (side !== undefined) m.after(due, (n) => this.beat(n, side));
      atBeat = plus(atBeat, T.beatEvery);
    }
    let last: Sourced<TickSpan> = T.firstBeatAfter;
    for (let i = 1; i < V.beats.value; i++) last = plus(last, T.beatEvery);
    const shout = plus(plus(last, T.beatExplodeAfter), T.strikeShoutAfterLastExplode);
    m.after(shout, (n) => this.strike(n, next));
  }

  private beat(m: P1Ctx<E>, side: Side): void {
    if (this.ending) return;
    const sw = m.boss.at;
    m.boss.play(SEQ.p1Charge);
    const look: Readonly<Record<Side, ATile>> = {
      east: at(sw.x + 11, sw.z + 1),
      south: at(sw.x + 1, sw.z - 10),
      west: at(sw.x - 10, sw.z + 1),
      north: at(sw.x + 1, sw.z + 11),
    };
    m.boss.faceTile(look[side]);
    // Two diagonals from one face, a quarter turn apart. The first closes after 4, the other after 6.
    const ends: Readonly<Record<Side, readonly [readonly [number, number, number, number], readonly [number, number, number, number]]>> = {
      east: [[3, 2, 1, 1], [3, 0, 1, -1]],
      south: [[2, -1, 1, -1], [0, -1, -1, -1]],
      west: [[-1, 0, -1, -1], [-1, 2, -1, 1]],
      north: [[0, 3, -1, 1], [2, 3, 1, 1]],
    };
    const [first, second] = ends[side];
    const [closeFirst, closeSecond] = pair(each(T.beatLineCloses));
    this.addLine(m, at(sw.x + first[0], sw.z + first[1]), { dx: first[2], dz: first[3] }, V.beatLineLength.value, closeFirst);
    this.addLine(m, at(sw.x + second[0], sw.z + second[1]), { dx: second[2], dz: second[3] }, V.beatLineLength.value, closeSecond);
    m.after(T.beatChargeAt, (n) => n.boss.spotanim(SPOT.p1Charge, "charge"));
    m.after(T.beatExplodeAfter, (n) => {
      n.boss.spotanim(SPOT.p1Charge, "charge");
      this.explode(n);
    });
    m.after(plus(T.beatExplodeAfter, T.oneTick), (n) => this.blast(n));
  }

  private strike(m: P1Ctx<E>, next: Quadrant): void {
    if (this.ending) return;
    const shots = 1 + Math.floor(this.meter / V.meterPerExtraShot.value);
    m.boss.say(shots <= 2 ? STRIKE_ONE : shots === 3 ? STRIKE_THREE : STRIKE_MANY, T.introLasts);
    this.meter = 0;
    m.boss.overhead("protect-melee");
    m.log({ kind: "strike", at: m.now, shots });
    m.after(T.oneTick, (n) => this.payBack(n, { kind: "strike-open" }));
    m.after(plus(T.oneTick, T.oneTick), (n) => {
      n.boss.play(SEQ.p1Expend);
      n.boss.facePlayer();
      n.show({ kind: "strike", shots, flight: T.oneTick.value });
      n.after(T.oneTick, (h) => h.hit({ kind: "strike" }, V.strikeDamage));
      if (shots > 1) {
        n.after(plus(T.oneTick, T.oneTick), (h) => {
          for (let i = 1; i < shots; i++) h.hit({ kind: "strike" }, V.strikeDamage);
        });
      }
    });
    m.after(T.walkOnAfterShout, (n) => {
      if (this.ending) return;
      if (this.crossed(n)) {
        this.startMiddle(n, next);
        return;
      }
      this.startWalk(n, next);
    });
  }

  private body(m: P1Ctx<E>): Body {
    return { sw: m.boss.at, size: BODY };
  }
}
