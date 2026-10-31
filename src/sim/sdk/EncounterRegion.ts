import { Region } from "osrs-sdk";
import type { Player } from "osrs-sdk";
import type { Tick } from "../brands";
import { worldTick } from "../brands";
import type { Entries, Host, MountedRoom, PhaseOf, Phases, RowOf, Run, Section, Setup } from "../encounter";
import { Director } from "../director";
import { toRoom } from "../frame";
import type { Encounter, Hooks } from "./EncounterBinding";
import { EncounterBinding } from "./EncounterBinding";
import type { EncounterPlayerHooks, PlayerHost, PlayerInput } from "./EncounterPlayer";
import { EncounterPlayer } from "./EncounterPlayer";

/** What a phase gets on the SDK: the region to build its units in, the run's one player, and a binding that reports that player to it. */
export type EncounterHost<E extends Entries> = Host<E> &
  Readonly<{
    region: Region;
    player: EncounterPlayer;
    bind<R extends Encounter & Readonly<{ input: PlayerInput }>>(start: Tick, hooks: Hooks<R>): EncounterBinding<R>;
  }>;

export class EncounterRegion<E extends Entries, Ph extends Phases<E, EncounterHost<E>>> extends Region implements Run<E, Ph> {
  private readonly director: Director<E, Ph, EncounterHost<E>>;
  private player: EncounterPlayer | null = null;
  private bound: PlayerHost | null = null;
  private scenery: MountedRoom | null = null;
  /** Set only by a shared fight, to the unit the room agreed the boss is on. Null means this client's own player. */
  private aimed: Player | null = null;

  /** Points the running phase at another unit between ticks. Swapping inside a tick would split one turn in two. */
  aimAt(unit: Player | null): void {
    this.aimed = unit;
  }

  constructor(private readonly setup: Setup<E, Ph, Region>) {
    super();
    this.director = new Director(setup, () => this.worldTickNow(), "region");
  }

  override getName(): string {
    return "Encounter";
  }

  override get width(): number {
    return this.setup.room.size.width;
  }

  override get height(): number {
    return this.setup.room.size.height;
  }

  override drawWorldBackground(context: OffscreenCanvasRenderingContext2D, scale: number): void {
    this.setup.room.drawFloor(context, scale);
  }

  override initialiseRegion(): { player: Player } {
    this.scenery?.dispose();
    const spawn = this.setup.room.spawn;
    const player = this.createPlayer({ x: spawn.x, y: spawn.y }, () => this.playerHooks());
    this.player = player;
    this.bound = null;
    this.scenery = this.setup.room.mount(this);
    this.addPlayer(player);
    this.director.begin(this.host(player));
    return { player };
  }

  /** A fight supplies its own player. The default is the engine player. */
  protected createPlayer(at: Readonly<{ x: number; y: number }>, hooks: () => EncounterPlayerHooks): EncounterPlayer {
    return new EncounterPlayer(this, at, hooks);
  }

  /** Unit constructors and Region.reset's setStats write SDK default stats, so phase entry is applied after both. */
  override reset(startWorld = true): { player: Player } {
    const result = super.reset(false);
    this.director.ready();
    if (startWorld) this.world.startTicking();
    return result;
  }

  get current(): PhaseOf<E> {
    return this.director.current;
  }

  sections(): readonly Section<E, Ph>[] {
    return this.director.sections();
  }

  rows<P extends PhaseOf<E>>(phase: P): readonly RowOf<Ph[P]>[] {
    return this.director.rows(phase);
  }

  override beforeNpcTurns(): void {
    this.director.beforeNpcTurns();
  }

  override postTick(): void {
    this.director.postTick();
  }

  /** `begin` reads this when the region opens the run, which can be before a caller assigns `world`. */
  private worldTickNow() {
    const running = this.world;
    return worldTick(running ? running.globalTickCounter : 0);
  }

  private host(player: EncounterPlayer): EncounterHost<E> {
    const director = this.director;
    return {
      seed: director.seed,
      room: {
        size: director.room.size,
        walkable: (tiles) => {
          if (this.scenery === null) throw new Error("a phase fenced its floor before the room was mounted");
          this.scenery.walkable(tiles);
        },
      },
      next: (to) => director.next(to, "region"),
      region: this,
      player,
      bind: (start, hooks) => {
        // The binding reads the player's steps off the SDK in room tiles; the phase reasons in its own.
        const inPhaseTiles: typeof hooks = { ...hooks, "player-moved": (moved) => hooks["player-moved"]({ ...moved, steps: moved.steps.map((at) => player.local(at)), at: player.local(moved.at) }) };
        const binding = new EncounterBinding(director.seed, start, () => this.aimed ?? player, inPhaseTiles);
        this.bound = binding;
        return binding;
      },
    };
  }

  private playerHooks(): EncounterPlayerHooks {
    return {
      host: () => this.bound,
      rules: () => this.director.rules(),
      frame: () => this.director.frame(),
      hop: (to) => {
        const player = this.player;
        if (player === null) throw new Error("a hop was asked for before the player was built");
        player.hop(toRoom(this.director.frame(), to));
      },
      canMelee: () => true,
    };
  }
}
