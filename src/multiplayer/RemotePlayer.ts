/**
 * Someone else's player, drawn in this client's world.
 *
 * It is a real SDK player and takes the engine's own movement step, because that step is what fills the visual path
 * the renderer walks and animates along: a figure moved by hand instead slides without a walk cycle and jumps
 * whenever a report lands mid-tick. The one thing it decides differently is where it is going, which it reads from
 * the room rather than from a click. Its combat, its pathing of its own and its click markers stay off, because the
 * client that owns it is the one that settles those.
 */
import { Player } from "osrs-sdk";
import type { Region } from "osrs-sdk";
import type { Gear, PlayerState, Style } from "./protocol";

const PROTECTION: Readonly<Record<Style, string>> = { melee: "melee", ranged: "range", magic: "magic" };

/** Further than a run could cover in a tick means a fall, a portal or a late packet, so the figure is placed. */
const TELEPORTS_BEYOND = 3;

export type RemoteLook = Readonly<{ name: string; dead: boolean; prayer: Style | null; hp: number; maxHp: number }>;

/** Dresses a puppet in the gear its owner named. The trainer supplies this; the room knows nothing of catalogs. */
export type Dresser = (player: RemotePlayer, gear: Gear | null) => void;

export class RemotePlayer extends Player {
  private look: RemoteLook;
  /** Where the room last said this player is. Stepping towards it is the engine's job, on its own tick. */
  private goal: Readonly<{ x: number; y: number }> | null = null;

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
   * Takes one report. Only the goal moves here, so a report landing between ticks cannot drag the figure sideways
   * mid-frame; the engine walks it there on the next tick like any other player.
   */
  apply(state: PlayerState): void {
    this.look = { ...this.look, dead: state.dead, prayer: state.prayer, hp: state.hp, maxHp: state.maxHp };
    // The world culls a player whose hitpoints reach 0, which would take the figure out of everyone's scene before
    // its owner said so, so the bar is drawn from a floor of 1 and death is the room's word instead.
    this.currentStats.hitpoint = Math.max(1, state.hp);
    this.stats.hitpoint = Math.max(1, state.maxHp);
    const away = Math.max(Math.abs(state.tile.x - this.location.x), Math.abs(state.tile.y - this.location.y));
    this.goal = { x: state.tile.x, y: state.tile.y };
    if (away > TELEPORTS_BEYOND) {
      this.location = { x: state.tile.x, y: state.tile.y };
      this.perceivedLocation = { x: state.tile.x, y: state.tile.y };
      this.visualPath = [];
    }
  }

  /**
   * The room's word on where to head, in place of the click a real player would make. The pace is the engine's own:
   * the figure covers two tiles when it is behind, exactly as its owner did.
   */
  override determineDestination(): void {
    if (this.goal !== null) this.destinationLocation = { x: this.goal.x, y: this.goal.y };
  }

  /** Overheads are drawn from the report rather than from a prayer book this client does not own. */
  override activatePrayers(): void {
    const wanted = this.look.prayer === null ? null : PROTECTION[this.look.prayer];
    for (const prayer of this.prayerController.prayers) {
      const on = wanted !== null && prayer.feature() === wanted;
      if (prayer.isActive !== on) prayer.toggle(this);
    }
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

export type Known = Readonly<{ name: string; gear: Gear | null }>;

/** Keeps one puppet per remote player, making, dressing and retiring them as the room changes. */
export class RemoteCrowd {
  private readonly puppets = new Map<string, RemotePlayer>();
  /** Who is standing in the scene right now: a dead player leaves it, as they do in game. */
  private readonly shown = new Set<string>();
  /** What each puppet was last dressed in, so gear is re-applied only when it actually changed. */
  private readonly worn = new Map<string, string>();

  constructor(private readonly region: Region, private readonly spawn: Readonly<{ x: number; y: number }>, private readonly dress: Dresser = () => {}) {}

  /** Applies a batch of reports, adding anyone newly seen and dressing them as the roster says. */
  apply(states: readonly PlayerState[], known: ReadonlyMap<string, Known>): void {
    for (const state of states) {
      const who = known.get(state.id);
      let puppet = this.puppets.get(state.id);
      if (!puppet) {
        puppet = new RemotePlayer(this.region, this.spawn, state.id, who?.name ?? "friend");
        this.puppets.set(state.id, puppet);
      }
      if (who !== undefined) puppet.setName(who.name);
      this.redress(puppet, who?.gear ?? null);
      puppet.apply(state);
      this.display(puppet, !state.dead);
    }
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

  private redress(puppet: RemotePlayer, gear: Gear | null): void {
    const key = gear === null ? "-" : `${gear.tier}:${gear.weapon ?? "-"}`;
    if (this.worn.get(puppet.id) === key) return;
    this.worn.set(puppet.id, key);
    this.dress(puppet, gear);
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
