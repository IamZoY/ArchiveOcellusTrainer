import type { Seed, Tick, TickSpan, WorldTick } from "./brands";
import type { Damage, HitReceipt, Style } from "./combat";
import type { Entries, Enter } from "./encounter";
import type { CueChange, Foretold, PrayerCue } from "./prayerCue";
import type { Threat, ThreatChange, Warning } from "./threat";
import type { DamageRange, Sourced } from "./sourced";
import type { Handle, Scope } from "./timers";
import { Timers } from "./timers";

/** What one closure-written phase names: its own tiles, hit causes, events, looks, roll streams and overheads. */
export type ScriptTypes = Readonly<{
  tile: unknown;
  cause: Readonly<{ kind: string }>;
  event: Readonly<{ kind: string; at: Tick }>;
  look: Readonly<{ kind: string }>;
  roll: string;
  overhead: string;
  input: unknown;
}>;

export type Observed<T extends ScriptTypes> = Readonly<{ tile: T["tile"]; hp: number; prayer: Style | null }>;

export type BossChange<T extends ScriptTypes> =
  | Readonly<{ kind: "animation"; id: number }>
  | Readonly<{ kind: "pose"; id: number | null }>
  | Readonly<{ kind: "said"; text: string; lasts: TickSpan }>
  | Readonly<{ kind: "overhead"; overhead: T["overhead"] | null }>
  | Readonly<{ kind: "faced-player" }>
  | Readonly<{ kind: "faced-tile"; tile: T["tile"] }>
  | Readonly<{ kind: "stepped"; to: T["tile"] }>
  | Readonly<{ kind: "jumped"; to: T["tile"]; over: TickSpan }>
  | Readonly<{ kind: "placed"; to: T["tile"] }>
  | Readonly<{ kind: "shown"; visible: boolean }>
  | Readonly<{ kind: "targetable"; targetable: boolean }>
  | Readonly<{ kind: "spotanim"; id: number; channel: string }>;

/** What the engine logs on its own: every hit with its cause and receipt, every heal, every look and every change to the boss. */
export type EngineEvent<T extends ScriptTypes> =
  | Readonly<{ kind: "hit-requested"; at: Tick; cause: T["cause"]; damage: Damage }>
  | Readonly<{ kind: "hit-landed"; at: Tick; cause: T["cause"]; receipt: HitReceipt }>
  | Readonly<{ kind: "healed"; at: Tick; cause: T["cause"]; target: "player" | "boss"; amount: number }>
  | Readonly<{ kind: "boss-changed"; at: Tick; change: BossChange<T> }>
  | Readonly<{ kind: "shown"; at: Tick; look: T["look"] }>
  | Readonly<{ kind: "prayer-told"; at: Tick; cue: PrayerCue }>
  | Readonly<{ kind: "prayer-dropped"; at: Tick; id: number }>
  | Readonly<{ kind: "threat-told"; at: Tick; threat: Threat<T["tile"]> }>
  | Readonly<{ kind: "threat-dropped"; at: Tick; id: string }>;

export type ScriptEvent<T extends ScriptTypes> = T["event"] | EngineEvent<T>;

export type ScriptRow<T extends ScriptTypes> = Readonly<{
  tick: Tick;
  worldTick: WorldTick;
  player: Readonly<{ atOpen: Observed<T>; atClose: Observed<T> }>;
  bossHp: Readonly<{ atOpen: number; atClose: number }>;
  combatDraws: number;
  inputs: readonly T["input"][];
  events: readonly ScriptEvent<T>[];
}>;

/** Everything the boss can be told to do. Each call is logged in the row before the body applies it. */
export interface BossControl<T extends ScriptTypes> {
  readonly at: T["tile"];
  readonly hp: number;
  readonly maxHp: number;
  readonly defence: number;
  play(animation: Sourced<number>): void;
  hold(pose: Sourced<number> | null): void;
  say(text: string, lasts: Sourced<TickSpan>): void;
  overhead(overhead: T["overhead"] | null): void;
  facePlayer(): void;
  faceTile(at: T["tile"]): void;
  step(to: T["tile"]): void;
  jump(to: T["tile"], over: Sourced<TickSpan>): void;
  /** Puts him there at once, unseen: he is hidden, or this is where he first appears. */
  place(to: T["tile"]): void;
  show(visible: boolean): void;
  targetable(targetable: boolean): void;
  spotanim(id: Sourced<number>, channel: string): void;
}

export type Step<E extends Entries, T extends ScriptTypes> = (m: Ctx<E, T>) => void;
/** A foretold attack's landing tick. `strike` deals it as a prayable hit of the foretold style and cause. */
export type Landing<E extends Entries, T extends ScriptTypes> = (m: Ctx<E, T>, strike: (damage: Sourced<DamageRange>) => void) => void;

/** The guide's view of a row: every cue told or dropped on it, in order. */
export function cueChanges<T extends ScriptTypes>(events: readonly ScriptEvent<T>[]): readonly CueChange[] {
  const changes: CueChange[] = [];
  for (const event of events) {
    if (!isCueEvent(event)) continue;
    if (event.kind === "prayer-told") changes.push({ kind: "told", cue: event.cue });
    else changes.push({ kind: "dropped", id: event.id });
  }
  return changes;
}

/** The mechanics guide's view of a row: every warning told or dropped on it, in order. */
export function threatChanges<T extends ScriptTypes>(events: readonly ScriptEvent<T>[]): readonly ThreatChange<T["tile"]>[] {
  const changes: ThreatChange<T["tile"]>[] = [];
  for (const event of events) {
    if (!isThreatEvent(event)) continue;
    if (event.kind === "threat-told") changes.push({ kind: "told", threat: event.threat });
    else changes.push({ kind: "dropped", id: event.id });
  }
  return changes;
}

type ThreatEvent<T extends ScriptTypes> = Extract<EngineEvent<T>, Readonly<{ kind: "threat-told" | "threat-dropped" }>>;

function isThreatEvent<T extends ScriptTypes>(event: ScriptEvent<T>): event is ThreatEvent<T> {
  return (event.kind === "threat-told" && "threat" in event) || (event.kind === "threat-dropped" && "id" in event);
}

type CueEvent<T extends ScriptTypes> = Extract<EngineEvent<T>, Readonly<{ kind: "prayer-told" | "prayer-dropped" }>>;

/** A phase's own event kinds are its to name, so the engine's cue kinds are told apart by kind and shape together. */
function isCueEvent<T extends ScriptTypes>(event: ScriptEvent<T>): event is CueEvent<T> {
  return (event.kind === "prayer-told" && "cue" in event) || (event.kind === "prayer-dropped" && "id" in event);
}

/** Everything a mechanic can do. It gets no SDK object, so every effect passes through here and lands in the row. */
export interface Ctx<E extends Entries, T extends ScriptTypes> {
  readonly now: Tick;
  readonly player: Observed<T>;
  readonly boss: BossControl<T>;
  /** Dies when the phase starts a new segment. */
  after(wait: Sourced<TickSpan>, step: Step<E, T>): Handle;
  /** Survives a new segment and dies with the phase: a blow already under way still lands. */
  afterPhase(wait: Sourced<TickSpan>, step: Step<E, T>): Handle;
  /** Survives a new segment and the phase's own end. */
  afterAlways(wait: Sourced<TickSpan>, step: Step<E, T>): Handle;
  cancel(handle: Handle): void;
  /** Drops every segment timer: the closures of the segment that just ended never run. */
  endSegment(): void;
  hit(cause: T["cause"], damage: Sourced<DamageRange>): void;
  /** Nothing under the matching protection prayer, read as the hit lands. */
  hitPrayable(cause: T["cause"], style: Style, damage: Sourced<DamageRange>): void;
  /**
   * A prayable attack told now, at its tell, that lands `wait` ticks on: its prayer cue is logged at once, and on the
   * landing tick `lands` runs and deals the hit through `strike`, or lets it miss. The cue and the hit share this one wait.
   * A cue whose timer dies before it lands, with its segment or by `cancel`, is logged as dropped.
   */
  foretell(wait: Sourced<TickSpan>, scope: Scope, attack: Foretold & Readonly<{ cause: T["cause"] }>, lands: Landing<E, T>): Handle;
  /**
   * A telegraphed mechanic told now that lands `wait` ticks on: its warning is logged at once and `step` runs on the landing
   * tick. Like `foretell`, a warning whose timer dies first is logged as dropped.
   */
  warn(wait: Sourced<TickSpan>, scope: Scope, warning: Warning<T["tile"]>, step: Step<E, T>): Handle;
  /** One range under the matching protection prayer and another without it, read as the hit lands. */
  hitByPrayer(cause: T["cause"], style: Style, prayed: Sourced<DamageRange>, unprayed: Sourced<DamageRange>): void;
  heal(cause: T["cause"], amount: number, target: "player" | "boss"): void;
  /** Keyed on the stream, the tick and the draw within them, so adding a mechanic never shifts another's rolls. */
  roll(stream: T["roll"] | T["cause"]["kind"], range: Sourced<DamageRange>): number;
  pick<V>(stream: T["roll"], from: readonly [V, ...V[]]): V;
  chance(stream: T["roll"], probability: Sourced<number>): boolean;
  log(event: T["event"]): void;
  show(look: T["look"]): void;
  next(to: Enter<E>): void;
}

/** One row per cause and event kind. A new mechanic without its fight-log replay, or a reason it has none, does not compile. */
export type Replay<L extends string> =
  | Readonly<{ kind: "log"; log: L; at: string; ticks: readonly number[] }>
  | Readonly<{ kind: "unlogged"; why: string }>;
export type Replays<T extends ScriptTypes, L extends string> = { readonly [K in T["cause"]["kind"] | T["event"]["kind"]]: Replay<L> };

/** How a run applies what its closures ask for. The SDK side implements it; core code names no SDK type. */
export type Body<T extends ScriptTypes> = Readonly<{
  at(): T["tile"];
  hp(): number;
  maxHp(): number;
  defence(): number;
  apply(change: BossChange<T>): void;
  heal(amount: number): void;
}>;

export type Script<E extends Entries, T extends ScriptTypes> = Readonly<{
  /** Runs on the phase's first tick, in place of due timers. */
  begin: Step<E, T>;
  /** Runs on every later tick, after that tick's due timers. */
  each: Step<E, T>;
  /** Runs as each of the phase's hits lands on the player, after its receipt is logged. */
  landed(m: Ctx<E, T>, cause: T["cause"], receipt: HitReceipt): void;
}>;

export type RunPorts<E extends Entries, T extends ScriptTypes> = Readonly<{
  seed: Seed;
  body: Body<T>;
  player(): Observed<T>;
  healPlayer(amount: number): void;
  next(to: Enter<E>): void;
}>;

type Told = Readonly<{ kind: "prayer"; id: number }> | Readonly<{ kind: "threat"; id: string }>;
type Open<T extends ScriptTypes> = Readonly<{ at: Tick; world: WorldTick; player: Observed<T>; bossHp: number }>;
type Requested<T extends ScriptTypes> = Readonly<{ cause: T["cause"]; damage: Damage }>;

function mix(seed: number, stream: string, at: number, draw: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < stream.length; i++) h = Math.imul(h ^ stream.charCodeAt(i), 0x01000193) >>> 0;
  h = (h ^ Math.imul(at, 0x85ebca6b) ^ Math.imul(draw + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return (h >>> 0) / 2 ** 32;
}

/**
 * A closure-written phase's clock and log. The region's turn hooks drive it: `open` at tick open runs due timers then the
 * phase's own tick, `requested` hands the boss's turn the hits to queue, `landed` takes each receipt, and `close` writes the row.
 */
export class ScriptRun<E extends Entries, T extends ScriptTypes> implements Ctx<E, T> {
  readonly boss: BossControl<T>;
  private readonly timers = new Timers<Ctx<E, T>>();
  private readonly journal: ScriptRow<T>[] = [];
  private readonly draws = new Map<string, number>();
  private opened: Open<T> | null = null;
  private begun = false;
  private clock: Tick;
  private events: ScriptEvent<T>[] = [];
  private queued: Requested<T>[] = [];
  /** Cues and warnings told whose timer has not come due, by that timer. */
  private readonly foretold = new Map<Handle, Told>();

  constructor(private readonly script: Script<E, T>, private readonly ports: RunPorts<E, T>, start: Tick) {
    this.clock = start;
    this.boss = this.control();
  }

  get now(): Tick {
    return this.clock;
  }

  get player(): Observed<T> {
    return this.ports.player();
  }

  get rows(): readonly ScriptRow<T>[] {
    return this.journal;
  }

  open(at: Tick, world: WorldTick): void {
    this.clock = at;
    this.draws.clear();
    this.opened = { at, world, player: this.ports.player(), bossHp: this.ports.body.hp() };
    if (!this.begun) {
      this.begun = true;
      this.script.begin(this);
      return;
    }
    for (const run of this.timers.take(at)) run(this);
    this.script.each(this);
  }

  requested(): readonly Requested<T>[] {
    const hits = this.queued;
    this.queued = [];
    return hits;
  }

  landed(cause: T["cause"], receipt: HitReceipt): void {
    this.events.push({ kind: "hit-landed", at: this.clock, cause, receipt });
    this.script.landed(this, cause, receipt);
  }

  close(combatDraws: number, inputs: readonly T["input"][]): ScriptRow<T> {
    const opened = this.opened;
    if (opened === null) throw new Error("a script row closed without opening");
    const row: ScriptRow<T> = {
      tick: opened.at,
      worldTick: opened.world,
      player: { atOpen: opened.player, atClose: this.ports.player() },
      bossHp: { atOpen: opened.bossHp, atClose: this.ports.body.hp() },
      combatDraws,
      inputs,
      events: this.events,
    };
    this.journal.push(row);
    this.events = [];
    this.opened = null;
    return row;
  }

  after(wait: Sourced<TickSpan>, step: Step<E, T>): Handle {
    return this.timers.add(this.clock, wait.value, "segment", step);
  }

  afterPhase(wait: Sourced<TickSpan>, step: Step<E, T>): Handle {
    return this.timers.add(this.clock, wait.value, "phase", step);
  }

  afterAlways(wait: Sourced<TickSpan>, step: Step<E, T>): Handle {
    return this.timers.add(this.clock, wait.value, "encounter", step);
  }

  cancel(handle: Handle): void {
    this.timers.cancel(handle);
    this.drop((pending) => pending === handle);
  }

  endSegment(): void {
    this.timers.leaveSegment();
    this.drop((pending) => pending.scope === "segment");
  }

  /** The phase is leaving: nothing it set runs again. */
  leave(): void {
    this.timers.leavePhase();
    this.foretold.clear();
  }

  foretell(wait: Sourced<TickSpan>, scope: Scope, attack: Foretold & Readonly<{ cause: T["cause"] }>, lands: Landing<E, T>): Handle {
    const { cause, ...told } = attack;
    const handle = this.timers.add(this.clock, wait.value, scope, (m) => {
      this.foretold.delete(handle);
      lands(m, (damage) => m.hitPrayable(cause, told.style, damage));
    });
    const cue: PrayerCue = { ...told, id: handle.order, told: this.clock, lands: handle.due };
    this.foretold.set(handle, { kind: "prayer", id: cue.id });
    this.events.push({ kind: "prayer-told", at: this.clock, cue });
    return handle;
  }

  warn(wait: Sourced<TickSpan>, scope: Scope, warning: Warning<T["tile"]>, step: Step<E, T>): Handle {
    const handle = this.timers.add(this.clock, wait.value, scope, (m) => {
      this.foretold.delete(handle);
      step(m);
    });
    const threat: Threat<T["tile"]> = { ...warning, id: `w${handle.order}`, told: this.clock, lands: handle.due };
    this.foretold.set(handle, { kind: "threat", id: threat.id });
    this.events.push({ kind: "threat-told", at: this.clock, threat });
    return handle;
  }

  hit(cause: T["cause"], damage: Sourced<DamageRange>): void {
    this.request(cause, { kind: "fixed", amount: this.roll(cause.kind, damage) });
  }

  hitPrayable(cause: T["cause"], style: Style, damage: Sourced<DamageRange>): void {
    this.request(cause, { kind: "by-prayer", style, protectedAmount: 0, unprotectedAmount: this.roll(cause.kind, damage) });
  }

  hitByPrayer(cause: T["cause"], style: Style, prayed: Sourced<DamageRange>, unprayed: Sourced<DamageRange>): void {
    this.request(cause, { kind: "by-prayer", style, protectedAmount: this.roll(cause.kind, prayed), unprotectedAmount: this.roll(cause.kind, unprayed) });
  }

  heal(cause: T["cause"], amount: number, target: "player" | "boss"): void {
    this.events.push({ kind: "healed", at: this.clock, cause, target, amount });
    if (target === "boss") this.ports.body.heal(amount);
    else this.ports.healPlayer(amount);
  }

  roll(stream: T["roll"] | T["cause"]["kind"], range: Sourced<DamageRange>): number {
    const { min, max } = range.value;
    return min + Math.floor(this.draw(stream) * (max - min + 1));
  }

  pick<V>(stream: T["roll"], from: readonly [V, ...V[]]): V {
    return from[Math.min(from.length - 1, Math.floor(this.draw(stream) * from.length))];
  }

  chance(stream: T["roll"], probability: Sourced<number>): boolean {
    return this.draw(stream) < probability.value;
  }

  log(event: T["event"]): void {
    this.events.push(event);
  }

  show(look: T["look"]): void {
    this.events.push({ kind: "shown", at: this.clock, look });
  }

  next(to: Enter<E>): void {
    this.ports.next(to);
  }

  private request(cause: T["cause"], damage: Damage): void {
    this.events.push({ kind: "hit-requested", at: this.clock, cause, damage });
    this.queued.push({ cause, damage });
  }

  private drop(dies: (pending: Handle) => boolean): void {
    for (const [handle, told] of this.foretold) {
      if (!dies(handle)) continue;
      this.foretold.delete(handle);
      switch (told.kind) {
        case "prayer":
          this.events.push({ kind: "prayer-dropped", at: this.clock, id: told.id });
          break;
        case "threat":
          this.events.push({ kind: "threat-dropped", at: this.clock, id: told.id });
          break;
        default: {
          const unhandled: never = told;
          return unhandled;
        }
      }
    }
  }

  private draw(stream: string): number {
    const n = this.draws.get(stream) ?? 0;
    this.draws.set(stream, n + 1);
    return mix(this.ports.seed, stream, this.clock, n);
  }

  private change(change: BossChange<T>): void {
    this.events.push({ kind: "boss-changed", at: this.clock, change });
    this.ports.body.apply(change);
  }

  private control(): BossControl<T> {
    const { body } = this.ports;
    const change = (next: BossChange<T>) => this.change(next);
    return {
      get at() {
        return body.at();
      },
      get hp() {
        return body.hp();
      },
      get maxHp() {
        return body.maxHp();
      },
      get defence() {
        return body.defence();
      },
      play: (animation) => change({ kind: "animation", id: animation.value }),
      hold: (pose) => change({ kind: "pose", id: pose === null ? null : pose.value }),
      say: (text, lasts) => change({ kind: "said", text, lasts: lasts.value }),
      overhead: (overhead) => change({ kind: "overhead", overhead }),
      facePlayer: () => change({ kind: "faced-player" }),
      faceTile: (at) => change({ kind: "faced-tile", tile: at }),
      step: (to) => change({ kind: "stepped", to }),
      jump: (to, over) => change({ kind: "jumped", to, over: over.value }),
      place: (to) => change({ kind: "placed", to }),
      show: (visible) => change({ kind: "shown", visible }),
      targetable: (targetable) => change({ kind: "targetable", targetable }),
      spotanim: (id, channel) => change({ kind: "spotanim", id: id.value, channel }),
    };
  }
}
