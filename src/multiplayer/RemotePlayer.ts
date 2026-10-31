/**
 * Someone else's player, drawn in this client's world.
 *
 * It is a real SDK player and takes the engine's own steps, because those are what fill the visual path the renderer
 * walks and animates along: a figure moved by hand instead slides without a walk cycle and jumps whenever a report
 * lands mid-tick. What it decides differently is where it is going, which it reads from the room rather than from a
 * click, and what it is praying, which it is told rather than choosing. Its combat, its own pathing and its click
 * markers stay off, because the client that owns it is the one that settles those.
 */
import { Player } from "osrs-sdk";
import type { Region } from "osrs-sdk";
import type { Gear, PlayerState, Style, WireTile, Worn } from "./protocol";

const PROTECTION: Readonly<Record<Style, string>> = { melee: "melee", ranged: "range", magic: "magic" };

/** Further than a run could cover in a tick means a fall, a portal or a late packet, so the figure is placed. */
const TELEPORTS_BEYOND = 3;

/** Steps still to walk before the route is given up as hopeless and the figure is simply put where it belongs. */
const GIVES_UP_AFTER = 5;

export type RemoteLook = Readonly<{ name: string; dead: boolean; prayer: Style | null; hp: number; maxHp: number }>;

/** Dresses a puppet in what its owner named and in what they have on right now. The room knows of no catalog. */
export type Dresser = (player: RemotePlayer, gear: Gear | null, worn: Worn | null) => void;

const far = (a: Readonly<{ x: number; y: number }>, b: Readonly<{ x: number; y: number }>): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** A route with one more reported tile on the end, and whether walking it is still worth trying. */
export type Queued = Readonly<{ route: readonly WireTile[]; place: boolean }>;

export function queueTile(route: readonly WireTile[], at: WireTile, tile: WireTile): Queued {
  const last = route[route.length - 1] ?? at;
  if (last.x === tile.x && last.y === tile.y) return { route, place: false };
  const grown = [...route, tile];
  return { route: grown, place: far(tile, at) > TELEPORTS_BEYOND || grown.length > GIVES_UP_AFTER };
}

/** The next move along a route: one queued tile at a time, running only to make up ground already lost. */
export type Step = Readonly<{ route: readonly WireTile[]; to: WireTile; running: boolean }>;

export function walkStep(route: readonly WireTile[], at: WireTile): Step {
  let first = 0;
  while (first < route.length && far(route[first] ?? at, at) === 0) first += 1;
  const rest = route.slice(first);
  const step = rest[0];
  if (step === undefined) return { route: rest, to: at, running: false };
  return { route: rest, to: step, running: rest.length > 1 || far(step, at) > 1 };
}

export class RemotePlayer extends Player {
  private look: RemoteLook;
  /**
   * Every tile its owner has stood on that this figure has yet to walk. Keeping the whole route rather than only the
   * newest tile is what makes the walk theirs: reports arrive in bursts, and a figure that only ever heads for the
   * latest one cuts the corners its owner walked round, or covers two tiles in a frame and reads as a stutter.
   */
  private route: readonly WireTile[] = [];

  constructor(region: Region, at: Readonly<{ x: number; y: number }>, private readonly who: string, name: string) {
    super(region, { x: at.x, y: at.y });
    this.look = { name, dead: false, prayer: null, hp: 99, maxHp: 99 };
    this.autoRetaliate = false;
  }

  get id(): string {
    return this.who;
  }

  setName(name: string): void {
    this.look = { ...this.look, name };
  }

  /** The SDK draws no player names, so this is for the trainer's own roster and overlays. */
  get displayName(): string {
    return this.look.name;
  }

  state(): RemoteLook {
    return this.look;
  }

  /**
   * Takes one report. Nothing here moves the figure: the tile joins the route and the engine walks it there on the
   * next tick, so a report landing between ticks cannot drag it sideways mid-frame.
   */
  apply(state: PlayerState): void {
    this.look = { ...this.look, dead: state.dead, prayer: state.prayer, hp: state.hp, maxHp: state.maxHp };
    // The world culls a player whose hitpoints reach 0, which would take the figure out of everyone's scene before
    // its owner said so, so the bar is drawn from a floor of 1 and death is the room's word instead.
    this.currentStats.hitpoint = Math.max(1, state.hp);
    this.stats.hitpoint = Math.max(1, state.maxHp);
    // Prayer and run belong to its owner, and a puppet that ran itself out of either would drop its overhead or
    // stop keeping up for reasons that happened on nobody's screen.
    this.currentStats.prayer = this.stats.prayer;
    this.currentStats.run = MAX_RUN_ENERGY;
    if (state.swing !== "none") this.swing(state.swing === "special");
    const queued = queueTile(this.route, this.location, state.tile);
    this.route = queued.route;
    if (queued.place) this.place(state.tile);
  }

  /**
   * Their swing, played here. The animation is the engine's own choice for what this figure is holding, which is
   * what they are holding, because the kit crossed the wire with them; a special is named by the weapon itself.
   * Turning to the boss is part of it: in game you see who someone is on before you see them hit it.
   */
  private swing(special: boolean): void {
    const boss = this.region.primaryBoss;
    if (boss !== null) this.setAggro(boss);
    const chosen = special ? this.equipment.weapon?.specialAttackAnimationId ?? null : null;
    this.playAttackAnimation(chosen ?? this.attackAnimationId ?? undefined);
  }

  /** Puts the figure down where the room says it is, for when walking there is no longer honest. */
  private place(tile: WireTile): void {
    this.location = { x: tile.x, y: tile.y };
    this.perceivedLocation = { x: tile.x, y: tile.y };
    this.visualPath = [];
    this.route = [];
    this.region.refreshUnitChunk(this);
  }

  /**
   * A friend is never a wall. The engine blocks the tile a unit stands on, which for a puppet would both pen players
   * in against each other and, worse, change how this client paths around them: the fight is the same on every
   * machine only while it is a pure function of its seed, and a figure that is somewhere else on your screen than on
   * mine must not be able to push your pathing off that.
   */
  override get consumesSpace(): boolean {
    return false;
  }

  /**
   * The room's word on where to head, in place of the click a real player would make. One queued step at a time, so
   * the figure takes the route its owner took; it runs when it has fallen behind, which is also what its owner did
   * if they covered two tiles in a tick.
   */
  override determineDestination(): void {
    const step = walkStep(this.route, this.location);
    this.route = step.route;
    this.running = step.running;
    this.destinationLocation = { x: step.to.x, y: step.to.y };
  }

  /**
   * Overheads come from the report rather than from a prayer book this client does not own, and are set rather than
   * clicked: a toggle is a request the engine grants a tick later, and only to a figure with the levels and the
   * points for it, neither of which a puppet has.
   */
  override activatePrayers(): void {
    const wanted = this.look.prayer === null ? null : PROTECTION[this.look.prayer];
    for (const prayer of this.prayerController.prayers) {
      const on = wanted !== null && prayer.feature() === wanted;
      prayer.isActive = on;
      prayer.isLit = on;
      prayer.nextActiveState = null;
    }
    this.overhead = this.prayerController.overhead();
  }

  /** Someone else's click marker is noise in your scene. */
  override updatePathMarker(): void {}

  // Their own client settles their combat, so this one never swings, retaliates or dies on its own.
  override attackStep(): void {}
  override attackIfPossible(): void {}
  override attack(): boolean {
    return false;
  }
  override dead(): void {}
  override get drawOutline(): boolean {
    return false;
  }
}

/** The engine's own ceiling for run energy, which a puppet is simply held at. */
const MAX_RUN_ENERGY = 10_000;

export type Known = Readonly<{ name: string; gear: Gear | null; dead: boolean }>;

/** Keeps one puppet per remote player, making, dressing and retiring them as the room changes. */
export class RemoteCrowd {
  private readonly puppets = new Map<string, RemotePlayer>();
  /** Who is standing in the scene right now: a dead player leaves it, as they do in game. */
  private readonly shown = new Set<string>();
  /** What each puppet was last dressed in, so a wardrobe is rebuilt only when it actually changed. */
  private readonly worn = new Map<string, string>();

  constructor(private readonly region: Region, private readonly spawn: Readonly<{ x: number; y: number }>, private readonly dress: Dresser = () => {}) {}

  /** Applies a batch of reports as it lands, so no tile of anyone's walk is lost between two of this client's ticks. */
  apply(states: readonly PlayerState[], known: ReadonlyMap<string, Known>): void {
    for (const state of states) {
      const who = known.get(state.id);
      let puppet = this.puppets.get(state.id);
      if (!puppet) {
        puppet = new RemotePlayer(this.region, this.spawn, state.id, who?.name ?? "friend");
        this.puppets.set(state.id, puppet);
      }
      if (who !== undefined) puppet.setName(who.name);
      this.redress(puppet, who?.gear ?? null, state.worn);
      puppet.apply(state);
      this.display(puppet, !state.dead && who?.dead !== true);
    }
  }

  /** The roster has the last word on who is still up, because a client that died stops reporting anything at all. */
  sync(known: ReadonlyMap<string, Known>): void {
    for (const [id, puppet] of this.puppets) {
      if (known.get(id)?.dead === true) this.display(puppet, false);
    }
    this.retain(new Set(known.keys()));
  }

  /** A living player stands in the scene; a dead one leaves it, and returns if the team runs the fight again. */
  private display(puppet: RemotePlayer, alive: boolean): void {
    const inScene = this.shown.has(puppet.id);
    if (alive === inScene) return;
    if (alive) {
      this.region.addPlayer(puppet);
      this.shown.add(puppet.id);
      return;
    }
    this.region.removePlayer(puppet);
    this.shown.delete(puppet.id);
  }

  /** What is on their back now wins over what they named in the lobby, so a swap mid-fight shows on every screen. */
  private redress(puppet: RemotePlayer, gear: Gear | null, worn: Worn | null): void {
    const key = worn === null ? `${gear?.tier ?? "-"}:${gear?.weapon ?? "-"}` : wornKey(worn);
    if (this.worn.get(puppet.id) === key) return;
    this.worn.set(puppet.id, key);
    this.dress(puppet, gear, worn);
  }

  /** Anyone no longer in the room is taken out of the world. */
  retain(ids: ReadonlySet<string>): void {
    for (const [id, puppet] of [...this.puppets]) {
      if (ids.has(id)) continue;
      this.display(puppet, false);
      this.puppets.delete(id);
      this.worn.delete(id);
    }
  }

  get(id: string): RemotePlayer | null {
    return this.puppets.get(id) ?? null;
  }

  all(): readonly RemotePlayer[] {
    return [...this.puppets.values()];
  }

  clear(): void {
    this.retain(new Set());
  }
}

function wornKey(worn: Worn): string {
  return Object.keys(worn)
    .sort()
    .map((slot) => `${slot}=${worn[slot] ?? "-"}`)
    .join(",");
}
