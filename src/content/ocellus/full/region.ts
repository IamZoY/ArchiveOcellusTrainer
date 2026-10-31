import { CacheRender, CacheRenderModel, CacheRenderReferences, CardinalDirection, TileMarker } from "osrs-sdk";
import type { Entity, Player, Region } from "osrs-sdk";
import type { FloorState } from "../fight/arena";
import { ArenaFloor, fullRoom } from "../fight/arena";
import { NPC, VOID_LOC, scaledHp } from "./data/looks";
import { P1 } from "./data/p1";
import { P2 } from "./data/p2";
import type { ATile, Body } from "../fight/geometry";
import { GRID, at, fromSdk, toSdk } from "../fight/geometry";
import type { TileMark } from "../fight/effects";
import { TileMarks } from "../fight/effects";
import type { LocView } from "../fight/locs";
import { LocField } from "../fight/locs";
import { FightPlayer } from "../fight/units";
import { releasePhase1Actors, warmPhase1Actors, warmStartPhase } from "../fight/warmup";
import type { DrillConfig } from "../js/OcellusTimings";
import { OCELLUS_P4, fullFightConfig } from "../js/OcellusTimings";
import type { Marked, P4Entry, P4Watch } from "../js/p4/phase";
import { markedOn, p4Phase, p4Threats, specialCues } from "../js/p4/phase";
import { seed, tile } from "../../../sim/brands";
import type { Style } from "../../../sim/combat";
import type { Room } from "../../../sim/encounter";
import { identity, toRoom } from "../../../sim/frame";
import type { EncounterPlayerHooks } from "../../../sim/sdk/EncounterPlayer";
import { EncounterRegion } from "../../../sim/sdk/EncounterRegion";
import { fence, seal } from "../../../sim/sdk/fence";
import { carriedEntry, drainedFall, phase4Opening } from "./fall";
import type { GuideCard } from "./prayerGuide";
import { PrayerGuide } from "./prayerGuide";
import type { MechanicLabel, MechanicLine, Timed, Whereabouts } from "./mechanicsGuide";
import { ThreatStore, mechanicLabels, mechanicLines, mechanicMarks, prayerThreat } from "./mechanicsGuide";
import { SceneLabels } from "../fight/effects";
import type { Spot, Threat, Where } from "../../../sim/threat";
import type { Frame } from "../../../sim/frame";
import type { Tile } from "../../../sim/brands";
import type { ChatLine, FullFightOptions, StartPhase } from "./options";
import type { P1Entry } from "./p1/types";
import type { P1Watch } from "./p1/sdk/phase";
import { p1Phase } from "./p1/sdk/phase";
import type { P2Watch } from "./p2/sdk/phase";
import { p2Phase } from "./p2/sdk/phase";
import type { P2Entry } from "./p2/types";
import type { P3Watch } from "./p3/sdk/phase";
import { p3Phase } from "./p3/sdk/phase";
import type { Fall, P3Entry } from "./p3/types";

const PHASE_4 = phase4Opening();

/** The body he spawns in for each start phase. Phase 1's hooded intro wears the phase 1 model. */
export const START_NPC: Readonly<Record<StartPhase, number>> = {
  1: NPC.p1,
  2: NPC.p2,
  3: NPC.p3,
  4: OCELLUS_P4.boss.npcId.value,
};

const SPAWN: Readonly<Record<StartPhase, ATile>> = { 1: at(0, -9), 2: at(5, -3), 3: at(5, -3), 4: PHASE_4.spawn };

export type { FullFightOptions } from "./options";

type FullEntries = Readonly<{ p1: P1Entry; p2: P2Entry; p3: P3Entry; p4: P4Entry }>;
type FullPhases = Readonly<{
  p1: ReturnType<typeof p1Phase<FullEntries>>;
  p2: ReturnType<typeof p2Phase<FullEntries>>;
  p3: ReturnType<typeof p3Phase<FullEntries>>;
  p4: ReturnType<typeof p4Phase<FullEntries>>;
}>;

const OPEN_ROOM: FloorState = { key: "open", floor: fullRoom(), stones: [], censers: [], crumbling: [], destroyed: [] };

/**
 * What the run's phases share and outlive them: the floor and voids as the last phase left them,
 * the chat, and the fight clock's reading on each later phase's tick 0.
 */
class Run {
  floor: () => FloorState = () => OPEN_ROOM;
  voids: readonly LocView[] = [];
  readonly chat: ChatLine[] = [];
  /** Fed by every phase as its rows close, whether or not the sidebar shows it, so turning it on mid-fight shows what is coming. */
  readonly guide = new PrayerGuide();
  /** The mechanics guide's warnings from phases 1 to 3, fed the same way. Phase 4's come off its schedule as they are read. */
  readonly threats = new ThreatStore();
  /** Phase 4's explosion marks still to land, so each impact names its tile. */
  marked: readonly Marked[] = [];
  p2From = 0;
  p3From = 0;
  p4From = 0;
  notify: () => void = () => undefined;

  constructor(public options: FullFightOptions) {}
}

function arenaRoom(start: StartPhase, run: Run): Room<Region> {
  const size = { width: GRID, height: GRID };
  const spawn = toSdk(SPAWN[start]);
  return {
    size,
    spawn: toRoom(identity(size), tile(spawn.x, spawn.y)),
    drawFloor(context, scale) {
      context.fillStyle = "#07060b";
      context.fillRect(0, 0, GRID * scale, GRID * scale);
    },
    mount(region: Region) {
      const scenery: Entity[] = [new ArenaFloor(region, () => run.floor()), new LocField(region, () => run.voids)];
      scenery.forEach((entity) => region.addEntity(entity));
      return {
        dispose: () => scenery.forEach((entity) => region.removeEntity(entity)),
        walkable: (tiles) => scenery.push(...fence(region, tiles), ...seal(region, tiles)),
      };
    },
  };
}

/** Phase 3's lingering voids, carried into phase 4. */
function voidsOf(fall: Fall): readonly LocView[] {
  return fall.voids.map(({ tile: on }) => ({ tile: on, models: VOID_LOC.bomb.models }));
}

function phasesOf(run: Run, p1: P1Watch, p2: P2Watch, p3: P3Watch, p4: P4Watch, p4Config: DrillConfig): FullPhases {
  return {
    p1: p1Phase<FullEntries>({
      settings: { practice: () => run.options.invincible, hazardTiles: () => run.options.hazardTiles, defenceDrained: () => run.options.defenceDrained },
      watch: p1,
      say: (line) => run.chat.push(line),
      hp: scaledHp(P1.hp, run.options.party),
      intoP2: (from) => {
        run.p2From = from;
        return { phase: "p2", entry: { kind: "followed" } };
      },
      changed: () => run.notify(),
      told: (now, changes) => run.guide.present(now, changes),
      warned: (now, changes) => run.threats.present(now, changes),
    }),
    p2: p2Phase<FullEntries>({
      settings: { practice: () => run.options.invincible, hazardTiles: () => run.options.hazardTiles, skipMarkers: () => run.options.skipMarkers, patternMarkers: () => run.options.patternMarkers, defenceDrained: () => run.options.defenceDrained },
      watch: p2,
      say: (line) => run.chat.push(line),
      intoP3: (hp) => {
        run.p3From = run.p2From + P2.p3At;
        return { phase: "p3", entry: { kind: "carried", boss: { hp } } };
      },
    }),
    p3: p3Phase<FullEntries>({
      settings: { practice: () => run.options.invincible, soloVine: () => run.options.soloVine, hazardTiles: () => run.options.hazardTiles, defenceDrained: () => run.options.defenceDrained },
      watch: p3,
      showFloor: (state) => {
        run.floor = state;
        return () => {
          const last = state();
          run.floor = () => last;
        };
      },
      fallInto: (fall) => {
        run.voids = voidsOf(fall);
        run.p4From = run.p3From + fall.tick;
        return { phase: "p4", entry: carriedEntry(fall, p4Config) };
      },
      say: (line) => run.chat.push(line),
      told: (now, changes) => run.guide.present(now, changes),
      warned: (now, changes) => run.threats.present(now, changes),
    }),
    p4: p4Phase<FullEntries>(p4, (row) => {
      run.guide.present(row.tick, specialCues(row));
      run.marked = [...run.marked, ...markedOn(row)].slice(-MARKS_KEPT);
    }),
  };
}

/** Which phase a fresh run opens on. Phase 4 opens on the third fall. */
function opened(start: StartPhase, config: DrillConfig, defenceDrained: boolean): { phase: "p1"; entry: P1Entry } | { phase: "p2"; entry: P2Entry } | { phase: "p3"; entry: P3Entry } | { phase: "p4"; entry: P4Entry } {
  switch (start) {
    case 1:
      return { phase: "p1", entry: { kind: "fresh" } };
    case 2:
      return { phase: "p2", entry: { kind: "opening" } };
    case 3:
      return { phase: "p3", entry: { kind: "fresh" } };
    case 4:
      return { phase: "p4", entry: carriedEntry(defenceDrained ? drainedFall(PHASE_4.fall) : PHASE_4.fall, config) };
    default: {
      const unhandled: never = start;
      return unhandled;
    }
  }
}

/** Enough explosion marks to cover every one still waiting to land. */
const MARKS_KEPT = 16;
/** How far ahead the mechanics guide reads phase 4's schedule. */
const P4_LOOKAHEAD = 30;

/** A phase 4 room tile as an arena tile. */
function arenaTile(frame: Frame, at: Tile): ATile {
  return fromSdk(toRoom(frame, at));
}

function arenaSpot(frame: Frame, spot: Spot<Tile>): Spot<ATile> {
  return spot.kind === "tile" ? { kind: "tile", tile: arenaTile(frame, spot.tile) } : spot;
}

function arenaWhere(frame: Frame, where: Where<Tile>): Where<ATile> {
  switch (where.kind) {
    case "tiles":
      return { kind: "tiles", tiles: where.tiles.map((at) => arenaTile(frame, at)) };
    case "spot":
      return { kind: "spot", at: arenaSpot(frame, where.at) };
    case "flight":
      return { ...where, from: arenaSpot(frame, where.from), to: arenaSpot(frame, where.to) };
    case "none":
      return where;
    default: {
      const unhandled: never = where;
      return unhandled;
    }
  }
}

/** The SDK names each protection prayer's style by its feature. */
const PRAYER_FEATURE: Readonly<Record<Style, string>> = { melee: "melee", ranged: "range", magic: "magic" };

/** What the prayer guide says while nothing prayable is on its way. */
const GUIDE_IDLE: Readonly<Record<keyof FullEntries, string>> = {
  p1: "No volley in the air. Each orb's colour names the next prayer.",
  p2: "Phase 2 has no prayable attacks.",
  p3: "No tell showing. Next to him, Protect from Melee takes most of his swings.",
  p4: "No transition attack coming.",
};

/** The reference video's tile markers, converted from region local tiles to arena offsets. */
const VIDEO_SQUARES: readonly (readonly [number, number])[] = [
  [-2, -2],
  [1, -2],
  [-2, 1],
  [1, 1],
  [-6, -6],
  [5, -6],
  [-6, 5],
  [5, 5],
];

export class FightRegion extends EncounterRegion<FullEntries, FullPhases> {
  readonly p1: P1Watch;
  readonly p2: P2Watch;
  readonly p3: P3Watch;
  readonly p4: P4Watch;
  readonly p4Config: DrillConfig;
  private readonly run: Run;
  private readonly listeners = new Set<() => void>();
  private readonly tickListeners = new Set<() => void>();
  private shownPhase: keyof FullEntries | null = null;

  constructor(options: FullFightOptions, private readonly dress: (player: Player) => void) {
    const run = new Run(options);
    const p1: P1Watch = { mounted: null };
    const p2: P2Watch = { mounted: null };
    const p3: P3Watch = { mounted: null };
    const p4: P4Watch = { invincible: options.invincible, mounted: null };
    const start = options.startPhase;
    const fightSeed = seed(options.seed);
    const config = fullFightConfig(fightSeed);
    if (start === 4) {
      run.floor = () => PHASE_4.floor;
      run.voids = voidsOf(PHASE_4.fall);
    }
    super({
      room: arenaRoom(start, run),
      phases: phasesOf(run, p1, p2, p3, p4, config),
      start: opened(start, config, options.defenceDrained),
      seed: fightSeed,
    });
    this.run = run;
    this.p1 = p1;
    this.p2 = p2;
    this.p3 = p3;
    this.p4 = p4;
    this.p4Config = config;
    run.notify = () => this.listeners.forEach((listener) => listener());
    if (options.videoMarkers) this.showVideoMarkers();
  }

  currentOptions(): FullFightOptions {
    return this.run.options;
  }

  /** The floor as the running phase lays it, and as the last one left it. */
  floorState(): FloorState {
    return this.run.floor();
  }

  chat(): readonly ChatLine[] {
    return this.run.chat;
  }

  /** The fight clock on a later phase's tick 0. Phase 1 starts at 0. */
  startOf(phase: "p2" | "p3" | "p4"): number {
    switch (phase) {
      case "p2":
        return this.run.p2From;
      case "p3":
        return this.run.p3From;
      case "p4":
        return this.run.p4From;
      default: {
        const unhandled: never = phase;
        return unhandled;
      }
    }
  }

  /** Region.reset writes default stats after construction, so the worn set goes on once that is done. */
  override reset(startWorld = true): { player: Player } {
    this.resetGuides();
    const result = super.reset(false);
    this.addEntity(new TileMarks(this, () => this.prayerHighlight()));
    this.addEntity(new TileMarks(this, () => this.mechanicMarks()));
    this.addEntity(new SceneLabels(this, () => this.mechanicLabels()));
    this.dress(result.player);
    this.warmHeldGraphics();
    if (startWorld) {
      this.preloadHeldGraphics();
      this.world.startTicking();
    }
    this.listeners.forEach((listener) => listener());
    return result;
  }

  override getName(): string {
    return "Ocellus";
  }

  /** You walk in from the south, facing him. */
  override get initialFacing(): CardinalDirection {
    return CardinalDirection.NORTH;
  }

  override drawDefaultFloor(): boolean {
    return false;
  }

  protected override createPlayer(atTile: Readonly<{ x: number; y: number }>, hooks: () => EncounterPlayerHooks): FightPlayer {
    return new FightPlayer(this, fromSdk(atTile), hooks);
  }

  /** The sidebar's practice toggle: it takes effect now, in the running fight, and in every restart. */
  setPractice(on: boolean): void {
    this.run.options = { ...this.run.options, invincible: on };
    this.p4.invincible = on;
  }

  /** The sidebar's phase 2 skip tiles, the same way. */
  setSkipMarkers(on: boolean): void {
    this.run.options = { ...this.run.options, skipMarkers: on };
    this.p2.mounted?.views.syncSkip();
  }

  /** The sidebar's phase 2 pattern tiles, the same way. */
  setPatternMarkers(on: boolean): void {
    this.run.options = { ...this.run.options, patternMarkers: on };
    this.p2.mounted?.views.syncPattern();
  }

  /** Danger-tile highlights, on for this fight and for the fight a restart builds. */
  setHazardTiles(on: boolean): void {
    this.run.options = { ...this.run.options, hazardTiles: on };
  }

  /** The prayer guide, the same way: its highlight shows from the next frame, and the page redraws its card now. */
  setPrayerGuide(on: boolean): void {
    this.run.options = { ...this.run.options, prayerGuide: on };
    this.listeners.forEach((listener) => listener());
  }

  /** The SDK's own overhead icon for the prayer that blocks `style`, as the card shows it. */
  prayerIcon(style: Style): string | null {
    const prayer = this.players[0]?.prayerController.prayers.find((each) => each.isOverhead() && each.feature() === PRAYER_FEATURE[style]);
    return prayer ? prayer.overheadImageReference() : null;
  }

  /** The mechanics guide, the same way. */
  setMechanicsGuide(on: boolean): void {
    this.run.options = { ...this.run.options, mechanicsGuide: on };
    this.listeners.forEach((listener) => listener());
  }

  /** Every mechanic still to land, soonest first, or null while the sidebar has the mechanics guide off. */
  mechanicsCard(): readonly MechanicLine[] | null {
    return this.run.options.mechanicsGuide ? mechanicLines(this.timedThreats()) : null;
  }

  /** The tiles the mechanics guide lights. Empty while it is off. */
  mechanicMarks(): readonly TileMark[] {
    return this.run.options.mechanicsGuide ? mechanicMarks(this.timedThreats(), this.whereabouts()) : [];
  }

  /** The countdowns the mechanics guide draws in the scene. Empty while it is off. */
  mechanicLabels(): readonly MechanicLabel[] {
    return this.run.options.mechanicsGuide ? mechanicLabels(this.timedThreats(), this.whereabouts(), this.world?.tickPercent ?? 0) : [];
  }

  private resetGuides(): void {
    this.run.guide.reset();
    this.run.threats.reset();
    this.run.marked = [];
    this.p4Read = null;
  }

  private p4Read: Readonly<{ at: number; threats: readonly Timed[] }> | null = null;

  /**
   * Phases 1 to 3's warnings and their prayer cues, or phase 4's schedule read ahead from the tick it stands on. Phase 4's
   * read is kept for the tick, so every frame of it costs nothing.
   */
  private timedThreats(): readonly Timed[] {
    if (this.current !== "p4") {
      const now = this.run.threats.now;
      return [...this.run.threats.coming(), ...this.run.guide.coming().map(prayerThreat)].map((threat) => ({ threat, now }));
    }
    const mounted = this.p4.mounted;
    const state = mounted?.ocellus.runState();
    if (!mounted || state?.kind !== "running") return [];
    if (this.p4Read?.at === state.tick) return this.p4Read.threats;
    const now = state.tick;
    const ahead = p4Threats(now, state.phase, mounted.ocellus.upcoming(now, P4_LOOKAHEAD), this.run.marked);
    const threats = ahead.map((threat): Timed => ({ threat: this.inArena(mounted.frame, threat), now }));
    this.p4Read = { at: now, threats };
    return threats;
  }

  private inArena(frame: Frame, threat: Threat<Tile>): Threat<ATile> {
    return { ...threat, where: arenaWhere(frame, threat.where) };
  }

  private whereabouts(): Whereabouts {
    return {
      boss: () => this.bossBody(),
      player: () => {
        const player = this.players[0];
        return player ? fromSdk(player.location) : null;
      },
    };
  }

  /** The guide's card for the HUD, or null while the sidebar has it off. */
  prayerCard(): GuideCard | null {
    return this.run.options.prayerGuide ? this.run.guide.card(GUIDE_IDLE[this.current]) : null;
  }

  /** The tiles the guide lights under the soonest attack's tell. Empty while the sidebar has it off. */
  prayerHighlight(): readonly TileMark[] {
    if (!this.run.options.prayerGuide) return [];
    return this.run.guide.marks({
      boss: () => this.bossBody(),
      player: () => {
        const player = this.players[0];
        return player ? fromSdk(player.location) : null;
      },
    });
  }

  /** His body in the running phase, as the SDK places it. */
  private bossBody(): Body | null {
    const boss = this.bossUnit();
    return boss && { sw: fromSdk(boss.location), size: boss.size };
  }

  private bossUnit(): Readonly<{ location: Readonly<{ x: number; y: number }>; size: number }> | null {
    switch (this.current) {
      case "p1":
        return this.p1.mounted?.boss ?? null;
      case "p2":
        return this.p2.mounted?.boss ?? null;
      case "p3":
        return this.p3.mounted?.boss ?? null;
      case "p4":
        return this.p4.mounted?.ocellus ?? null;
      default: {
        const unhandled: never = this.current;
        return unhandled;
      }
    }
  }

  /**
   * He only spawns when the fight starts, after the loading splash, so load his first body with the arena: otherwise
   * the splash clears onto an empty room and he downloads in front of the player. The start phase's graphics build
   * here too, rather than stalling its first attacks, and before the arena's own preload places any of them.
   */
  override async preload(): Promise<void> {
    const anchor = this.entities[0];
    const start = this.run.options.startPhase;
    this.warmHeldGraphics();
    const boss = anchor ? CacheRenderModel.forRenderable(anchor, CacheRenderReferences.npc(START_NPC[start])).preload() : Promise.resolve();
    if (anchor) await warmStartPhase(anchor, start);
    await Promise.all([super.preload(), boss]);
    this.releaseHeldGraphics();
  }

  private phase1Hosts() {
    const phase1 = this.run.options.startPhase === 1 ? this.p1.mounted : null;
    const player = this.players[0];
    if (!phase1 || !player || !CacheRender.isConfigured()) return null;
    return { boss: phase1.boss, player };
  }

  private warmHeldGraphics(): void {
    const hosts = this.phase1Hosts();
    if (hosts) warmPhase1Actors(hosts);
  }

  private releaseHeldGraphics(): void {
    const hosts = this.phase1Hosts();
    if (hosts) releasePhase1Actors(hosts);
  }

  private preloadHeldGraphics(): void {
    const hosts = this.phase1Hosts();
    if (!hosts) return;
    void Promise.all([hosts.boss.preload(), hosts.player.preload()]).finally(() => releasePhase1Actors(hosts));
  }

  /** A death in phase 1 ends the run here. Phases 2 and 3 end their own, and P4 ends its own. */
  override onGameOver(): void {
    if (this.current === "p1") this.p1.mounted?.script.lose();
    this.world.stopTicking();
  }

  onFightChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  override postTick(): void {
    if (this.current === "p1" && this.players.some((player) => player.dying === 0)) this.p1.mounted?.script.lose();
    if (this.current === "p2" && this.players.some((player) => player.dying === 0)) this.p2.mounted?.script.lose();
    if (this.current === "p3" && this.players.some((player) => player.dying === 0)) this.p3.mounted?.script.lose();
    super.postTick();
    if (this.current !== this.shownPhase) {
      if (this.shownPhase !== null) this.resetGuides();
      this.shownPhase = this.current;
      this.listeners.forEach((listener) => listener());
    }
    this.tickListeners.forEach((listener) => listener());
  }

  /** Called after every world tick's phase work, for a page that follows the fight clock. */
  onTick(listener: () => void): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  ticks(): number {
    const running = this.world;
    return running ? running.globalTickCounter : 0;
  }

  private showVideoMarkers(): void {
    for (const [x, z] of VIDEO_SQUARES) {
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        this.addEntity(new TileMarker(this, toSdk(at(x + dx, z + dz)), "#FFF100", 1, false));
      }
    }
  }
}

/** Phases 1, 2 and 3, then phase 4, in one region. */
export function fullFightStaged(options: FullFightOptions, dress: (player: Player) => void): FightRegion {
  return new FightRegion(options, dress);
}
