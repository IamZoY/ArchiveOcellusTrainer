/**
 * Someone else's player, drawn in this client's world.
 *
 * It is a real SDK player so the renderer, the minimap and the click-through all treat it as one, but it decides
 * nothing: no input, no pathing, no combat. Each report from the room moves it one step, and the SDK's own
 * interpolation carries it between ticks, which is what makes a friend's run look like walking rather than blinking.
 */
import { Player } from "osrs-sdk";
import type { Region } from "osrs-sdk";
import type { Gear, PlayerState, Style } from "./protocol";

const PROTECTION: Readonly<Record<Style, string>> = { melee: "melee", ranged: "range", magic: "magic" };

export type RemoteLook = Readonly<{ name: string; dead: boolean; prayer: Style | null; hp: number; maxHp: number }>;

/** Dresses a puppet in the gear its owner named. The trainer supplies this; the room knows nothing of catalogs. */
export type Dresser = (player: RemotePlayer, gear: Gear | null) => void;

export class RemotePlayer extends Player {
  private look: RemoteLook;

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
   * Takes one report. A step of a tile or two is walked so the SDK tweens it; anything further is a teleport, a
   * fall or a late packet, and is placed outright rather than shown as an impossible sprint.
   */
  apply(state: PlayerState): void {
    this.look = { ...this.look, dead: state.dead, prayer: state.prayer, hp: state.hp, maxHp: state.maxHp };
    this.currentStats.hitpoint = state.hp;
    this.stats.hitpoint = state.maxHp;
    const far = Math.max(Math.abs(state.tile.x - this.location.x), Math.abs(state.tile.y - this.location.y));
    if (far === 0) return;
    if (far > 2) {
      this.perceivedLocation = { x: state.tile.x, y: state.tile.y };
      this.location = { x: state.tile.x, y: state.tile.y };
      return;
    }
    this.perceivedLocation = { x: this.location.x, y: this.location.y };
    this.location = { x: state.tile.x, y: state.tile.y };
  }

  /** Overheads are drawn from the report rather than from a prayer book this client does not own. */
  override activatePrayers(): void {
    const wanted = this.look.prayer === null ? null : PROTECTION[this.look.prayer];
    for (const prayer of this.prayerController.prayers) {
      const on = wanted !== null && prayer.feature() === wanted;
      if (prayer.isActive !== on) prayer.toggle(this);
    }
  }

  // Nothing below here may run: a puppet that paths, attacks or dies on its own would disagree with its owner.
  override movementStep(): void {}
  override attackStep(): void {}
  override attackIfPossible(): void {}
  override determineDestination(): void {}
  override moveTowardsDestination(): void {}
  override attack(): boolean {
    return false;
  }
  override dead(): void {}
  override get drawOutline(): boolean {
    return false;
  }
}

export type Known = Readonly<{ name: string; gear: Gear | null }>;

/** Keeps one puppet per remote player, making and retiring them as the roster changes. */
export class RemoteCrowd {
  private readonly puppets = new Map<string, RemotePlayer>();
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
        this.region.addPlayer(puppet);
      }
      if (who !== undefined) puppet.setName(who.name);
      this.redress(puppet, who?.gear ?? null);
      puppet.apply(state);
    }
  }

  private redress(puppet: RemotePlayer, gear: Gear | null): void {
    const key = gear === null ? "-" : `${gear.tier}:${gear.weapon ?? "-"}`;
    if (this.worn.get(puppet.id) === key) return;
    this.worn.set(puppet.id, key);
    this.dress(puppet, gear);
  }

  /** Anyone no longer on the roster is taken out of the world. */
  retain(ids: ReadonlySet<string>): void {
    for (const [id, puppet] of [...this.puppets]) {
      if (ids.has(id)) continue;
      this.region.removePlayer(puppet);
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
