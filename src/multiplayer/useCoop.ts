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
import { RoomClient } from "./client";
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

export function useCoop(bridge: FightBridge): CoopHandle {
  const client = useMemo(() => new RoomClient(), []);
  const phase = useSyncExternalStore(
    useCallback((changed: () => void) => client.subscribe(changed), [client]),
    useCallback(() => client.phase(), [client]),
  );
  const [session, setSession] = useState<MultiplayerSession | null>(null);
  const [, bump] = useState(0);
  const joined = useRef(false);

  // A link with a room code in it joins by itself, which is also how a guest comes back after the seed reload.
  useEffect(() => {
    if (joined.current) return;
    const code = codeInUrl();
    const name = savedName();
    if (code === null || name.trim().length === 0) return;
    joined.current = true;
    void client.join(code, name.trim());
  }, [client]);

  // A guest on the wrong seed cannot share this fight, so it reloads onto the host's before anything starts.
  useEffect(() => {
    if (phase.kind !== "lobby" && phase.kind !== "fighting") return;
    const { connection } = phase;
    if (connection.host || connection.seed === bridge.seed) return;
    reloadOnto(connection);
  }, [phase, bridge.seed]);

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
