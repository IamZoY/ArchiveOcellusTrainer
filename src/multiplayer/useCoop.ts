/**
 * Holds the co-op room for the running page: one client, one session, and the small amount of reconciling a shared
 * fight needs before it can start.
 *
 * The fight is a pure function of its seed, so everyone in a room has to be on the host's. A guest that opened the
 * page on a different one reloads onto the host's and rejoins, which is cheaper to reason about than rebuilding a
 * live region underneath a running renderer.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Player } from "osrs-sdk";
import { RoomClient, savedSeat } from "./client";
import type { Connection } from "./client";
import { MultiplayerSession } from "./session";
import type { FightPorts, LocalView } from "./session";
import { codeInUrl } from "./Lobby";
import type { Gear, PlayerId, Style } from "./protocol";
import type { Dresser } from "./RemotePlayer";

const NAME_KEY = "archive-ocellus-coop-name";

export type CoopHandle = Readonly<{
  client: RoomClient;
  session: MultiplayerSession | null;
  targetId: PlayerId | null;
  dead: boolean;
  watchingName: string | null;
  /**
   * Dead while the fight is still on. The run's own result offers a restart that would leave the room behind, so it
   * waits until the whole team is down, which is when the fight is really over.
   */
  spectating: boolean;
}>;

/** What the page must give the hook so it can watch and steer the fight. */
export type FightBridge = Readonly<{
  onTick(listener: () => void): () => void;
  tickNow(): number;
  localPlayer(): Player | null;
  protection(): Style | null;
  aimAt(unit: Player | null): void;
  spawn(): Readonly<{ x: number; y: number }>;
  region: ConstructorParameters<typeof MultiplayerSession>[2];
  seed: number;
  startPhase: number;
  startFight(): void;
  /** True once this client's own run has ended in a death. */
  lost(): boolean;
  /** What this player is wearing, and how to put someone else's on a puppet. */
  gear(): Gear;
  dress: Dresser;
}>;

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Sends the page to the host's seed, keeping the room so the reload lands straight back in the lobby. */
function reloadOnto(connection: Connection): void {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", String(connection.seed));
  url.searchParams.set("phase", String(connection.startPhase));
  url.searchParams.set("room", connection.code);
  window.location.replace(url.toString());
}

/**
 * A fresh run needs a fresh fight, and a running region cannot be rebuilt under the renderer, so the page reloads
 * with the room and seed it already has and auto-joins straight back into the lobby.
 */
function reloadIntoRoom(code: string, seed: number): void {
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  url.searchParams.set("seed", String(seed));
  window.location.replace(url.toString());
}

export function useCoop(bridge: FightBridge): CoopHandle {
  const client = useMemo(() => new RoomClient(), []);
  // Read when it fires, not when it is registered: the room is not joined yet at the time this runs.
  useEffect(() => {
    client.on({
      regroup: () => {
        const now = client.phase();
        if (now.kind === "lobby" || now.kind === "fighting") reloadIntoRoom(now.connection.code, now.connection.seed);
      },
    });
  }, [client]);
  const phase = useSyncExternalStore(
    useCallback((changed: () => void) => client.subscribe(changed), [client]),
    useCallback(() => client.phase(), [client]),
  );
  const [session, setSession] = useState<MultiplayerSession | null>(null);
  const [, bump] = useState(0);
  const joined = useRef(false);

  // A link with a room code in it joins by itself, which is also how a page comes back after a reload. A tab that
  // already holds a seat in that room takes it back instead of joining, so it keeps its name, its host seat and its
  // ready, and so the room does not refuse it for using a name it is already using.
  useEffect(() => {
    if (joined.current) return;
    const code = codeInUrl();
    if (code === null) return;
    joined.current = true;
    const held = savedSeat(code);
    if (held !== null) {
      client.resume(code, held, bridge.seed, bridge.startPhase);
      return;
    }
    const name = savedName();
    if (name.trim().length === 0) {
      joined.current = false;
      return;
    }
    void client.join(code, name.trim(), bridge.gear());
  }, [client, bridge]);

  // A guest on the wrong seed cannot share this fight, so it reloads onto the host's before anything starts. The
  // seat is given up first, or the page that comes back would find its own name already in the room.
  useEffect(() => {
    if (phase.kind !== "lobby" && phase.kind !== "fighting") return;
    const { connection } = phase;
    if (connection.host || connection.seed === bridge.seed) return;
    void client.leaveAndWait().then(() => reloadOnto(connection));
  }, [phase, bridge.seed, client]);

  useEffect(() => {
    if (phase.kind !== "fighting") {
      setSession(null);
      return;
    }
    const ports: FightPorts = {
      onTick: bridge.onTick,
      tickNow: bridge.tickNow,
      local: (): LocalView | null => {
        const player = bridge.localPlayer();
        if (!player) return null;
        return {
          tile: { x: player.location.x, y: player.location.y },
          hp: player.currentStats.hitpoint,
          maxHp: player.stats.hitpoint,
          prayer: bridge.protection(),
        };
      },
      kill: () => {
        const player = bridge.localPlayer();
        if (player) player.currentStats.hitpoint = 0;
      },
      damage: (amount) => {
        const player = bridge.localPlayer();
        if (player) player.currentStats.hitpoint = Math.max(0, player.currentStats.hitpoint - amount);
      },
    };
    const made = new MultiplayerSession(client, ports, bridge.region, bridge.spawn(), bridge.dress);
    const stop = made.begin();
    setSession(made);
    const off = made.subscribe(() => bump((n) => n + 1));
    // Dying ends the run, and an ended run stops ticking, so the fight's own clock cannot be what notices it.
    const pulse = setInterval(() => {
      const player = bridge.localPlayer();
      if (bridge.lost() || (player !== null && player.currentStats.hitpoint <= 0)) made.die();
    }, 250);
    bridge.startFight();
    return () => {
      clearInterval(pulse);
      off();
      stop();
      bridge.aimAt(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, client]);

  // Every client points its fight at whoever the room agreed the boss is on, so only that person takes the damage.
  const targetId = session?.targetId() ?? null;
  useEffect(() => {
    if (session === null) return;
    const me = phase.kind === "lobby" || phase.kind === "fighting" ? phase.connection.you : null;
    if (targetId === null || targetId === me) {
      bridge.aimAt(null);
      return;
    }
    bridge.aimAt(session.others().find((other) => other.id === targetId) ?? null);
  }, [session, targetId, phase, bridge]);

  const view = session?.view() ?? { dead: false, watching: null };
  const roster = phase.kind === "lobby" || phase.kind === "fighting" ? phase.roster : [];
  const watchingName = view.watching === null ? null : roster.find((member) => member.id === view.watching)?.name ?? null;

  const allDown = roster.length > 0 && roster.every((member) => member.dead);
  return { client, session, targetId, dead: view.dead, watchingName, spectating: view.dead && !allDown };
}
