/**
 * Ties one room to one running fight.
 *
 * Each tick this reports where the local player is and applies whatever the room has heard about everyone else. The
 * host additionally says who the boss is on and what each hit did; a guest takes that verdict rather than its own,
 * which is what stops two machines disagreeing about who is still alive.
 */
import type { RoomClient } from "./client";
import type { Authority, Member, PlayerId, PlayerState, Style } from "./protocol";
import { RemoteCrowd } from "./RemotePlayer";
import type { RemotePlayer } from "./RemotePlayer";

export type LocalView = Readonly<{
  tile: Readonly<{ x: number; y: number }>;
  hp: number;
  maxHp: number;
  prayer: Style | null;
}>;

/** What the session needs of the running fight, kept narrow so it can be driven by a fake in a test. */
export type FightPorts = Readonly<{
  onTick(listener: () => void): () => void;
  local(): LocalView | null;
  tickNow(): number;
  /** Puts the local player out of the fight without ending the page, so a dead player can watch. */
  kill(): void;
  damage(amount: number): void;
}>;

export type Spectating = Readonly<{ dead: boolean; watching: PlayerId | null }>;

/** How the host picks who the boss is on: the longest-standing living player, changing only when that one dies. */
export function nextTarget(roster: readonly Member[], current: PlayerId | null): PlayerId | null {
  const living = roster.filter((member) => !member.dead);
  if (living.length === 0) return null;
  if (current !== null && living.some((member) => member.id === current)) return current;
  return living[0]?.id ?? null;
}

export class MultiplayerSession {
  private readonly crowd: RemoteCrowd;
  private stop: (() => void) | null = null;
  private pending: readonly PlayerState[] = [];
  private spectating: Spectating = { dead: false, watching: null };
  private target: PlayerId | null = null;
  private readonly watchers = new Set<() => void>();
  private applied = -1;
  private lastHp: number | null = null;

  constructor(
    private readonly client: RoomClient,
    private readonly ports: FightPorts,
    region: ConstructorParameters<typeof RemoteCrowd>[0],
    spawn: ConstructorParameters<typeof RemoteCrowd>[1],
  ) {
    this.crowd = new RemoteCrowd(region, spawn);
  }

  subscribe(watcher: () => void): () => void {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  private changed(): void {
    for (const watcher of this.watchers) watcher();
  }

  view(): Spectating {
    return this.spectating;
  }

  targetId(): PlayerId | null {
    return this.target;
  }

  others(): readonly RemotePlayer[] {
    return this.crowd.all();
  }

  /** Starts reporting and listening. Returns a teardown for when the fight or the page ends. */
  begin(): () => void {
    this.client.on({
      states: (states) => {
        this.pending = states;
      },
      authority: (authority) => this.takeAuthority(authority),
      intent: () => {},
      ended: () => this.end(),
    });
    const off = this.ports.onTick(() => this.tick());
    this.stop = off;
    return () => this.end();
  }

  private end(): void {
    this.stop?.();
    this.stop = null;
    this.crowd.clear();
    this.changed();
  }

  private roster(): readonly Member[] {
    const phase = this.client.phase();
    return phase.kind === "lobby" || phase.kind === "fighting" ? phase.roster : [];
  }

  private names(): ReadonlyMap<PlayerId, string> {
    return new Map(this.roster().map((member) => [member.id, member.name]));
  }

  private tick(): void {
    const at = this.ports.tickNow();
    const local = this.ports.local();

    if (local !== null) {
      this.client.report({ tick: at, tile: local.tile, hp: local.hp, maxHp: local.maxHp, prayer: local.prayer, dead: this.spectating.dead });
    }

    const names = this.names();
    this.crowd.apply(this.pending, names, at);
    this.crowd.retain(new Set(this.roster().map((member) => member.id)));

    if (this.client.isHost()) this.judge(at, local);
    this.follow();
  }

  /**
   * The host's verdict. Damage is not recomputed here: the host's own fight already applied it to whoever the boss
   * was on, so this reports what happened rather than inventing it.
   */
  private judge(at: number, local: LocalView | null): void {
    const roster = this.roster();
    const chosen = nextTarget(roster, this.target);
    if (chosen !== this.target) {
      this.target = chosen;
      this.changed();
    }
    this.client.judge({
      tick: at,
      targetId: chosen,
      hits: this.hitTaken(local),
      deaths: roster.filter((member) => member.dead).map((member) => member.id),
    });
  }

  /** A drop in the host's own hp since last tick is the one hit the host can speak for first-hand. */
  private hitTaken(local: LocalView | null): Authority["hits"] {
    const before = this.lastHp;
    this.lastHp = local?.hp ?? null;
    const me = this.me();
    if (local === null || before === null || local.hp >= before || me === "") return [];
    return [{ id: me, damage: before - local.hp, cause: "fight" }];
  }

  private me(): PlayerId {
    const phase = this.client.phase();
    return phase.kind === "lobby" || phase.kind === "fighting" ? phase.connection.you : "";
  }

  /** A guest takes the host's word for what it took, and for who has died. */
  private takeAuthority(authority: Authority): void {
    if (this.client.isHost() || authority.tick <= this.applied) return;
    this.applied = authority.tick;
    if (authority.targetId !== this.target) {
      this.target = authority.targetId;
      this.changed();
    }
    const me = this.me();
    for (const hit of authority.hits) {
      if (hit.id === me && hit.damage > 0) this.ports.damage(hit.damage);
    }
    if (authority.deaths.includes(me) && !this.spectating.dead) this.die();
  }

  /** Called by the page when the local fight killed this player, and by the host's verdict for a guest. */
  die(): void {
    if (this.spectating.dead) return;
    this.spectating = { dead: true, watching: null };
    this.ports.kill();
    this.follow();
    this.changed();
  }

  /** A dead player watches someone who is still up, and keeps watching until that one dies too. */
  private follow(): void {
    if (!this.spectating.dead) return;
    const watched = this.spectating.watching === null ? null : this.crowd.get(this.spectating.watching);
    if (watched !== null && !watched.state().dead) return;
    const next = this.crowd.anyAlive();
    const watching = next?.id ?? null;
    if (watching === this.spectating.watching) return;
    this.spectating = { dead: true, watching };
    this.changed();
  }

  /** The unit a spectating player's camera should sit on, or null to leave it where it is. */
  watching(): RemotePlayer | null {
    const id = this.spectating.watching;
    return id === null ? null : this.crowd.get(id);
  }
}
