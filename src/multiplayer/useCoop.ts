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
import type { Gear, PlayerId, Style, Swing, Worn } from "./protocol";
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
  /**
   * This page belongs to a room, so the fight is the room's to start. True from the first paint when the address
   * bar names a room, because the page is ready again long before the stream is: the solo Start would otherwise
   * be there to click in between, and a client that took it would run the fight alone while the room waited.
   */
  inRoom: boolean;
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
  /** What this player named in the lobby, what they have on right now, and how to put either on a puppet. */
  gear(): Gear;
  worn(): Worn | null;
  /** Whether this player swung on the tick now being reported, and whether it was a special. */
  swing(): Swing;
  dress: Dresser;
}>;

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Sends the page to the room's fight, keeping the room so the reload lands straight back in the lobby. It is also
 * how a fresh run starts: a fight runs off its seed from its first tick and cannot be rewound under the renderer,
 * so the page is loaded again on the same one. Everything the room decides travels here, seed and phase both.
 */
function reloadOnto(connection: Connection): void {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", String(connection.seed));
  url.searchParams.set("phase", String(connection.startPhase));
  url.searchParams.set("room", connection.code);
  window.location.replace(url.toString());
}

/** True when this page is running the fight the room is on, rather than one of its own. */
function onTheRoomsFight(connection: Connection, seed: number, startPhase: number): boolean {
  return connection.seed === seed && connection.startPhase === startPhase;
}

export function useCoop(bridge: FightBridge): CoopHandle {
  const client = useMemo(() => new RoomClient(), []);
  // Read when it fires, not when it is registered: the room is not joined yet at the time this runs.
  useEffect(() => {
    client.on({
      regroup: () => {
        const now = client.phase();
        if (now.kind === "lobby" || now.kind === "fighting") reloadOnto(now.connection);
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
  /** Whether this page has gone for a room at all, which a code in the address bar alone does not say. */
  const [tried, setTried] = useState(false);

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
      setTried(true);
      client.resume(code, held, bridge.seed, bridge.startPhase);
      return;
    }
    const name = savedName();
    if (name.trim().length === 0) {
      joined.current = false;
      return;
    }
    setTried(true);
    void client.join(code, name.trim(), bridge.gear());
  }, [client, bridge]);

  // Changing a setting here loads the page again on a new fight, which for the host is the room moving with them:
  // the room is told, and everyone else comes along. A guest cannot take the room anywhere, so this is the host's.
  useEffect(() => {
    if (phase.kind !== "lobby") return;
    const { connection } = phase;
    if (!connection.host || onTheRoomsFight(connection, bridge.seed, bridge.startPhase)) return;
    client.setup(bridge.seed, bridge.startPhase);
  }, [phase, bridge.seed, bridge.startPhase, client]);

  // A guest on another seed or another starting phase is not in this fight at all, so it loads the room's before
  // anything starts. The seat is given up first, or the page that comes back would find its own name in the room.
  useEffect(() => {
    if (phase.kind !== "lobby" && phase.kind !== "fighting") return;
    const { connection } = phase;
    if (connection.host || onTheRoomsFight(connection, bridge.seed, bridge.startPhase)) return;
    void client.leaveAndWait().then(() => reloadOnto(connection));
  }, [phase, bridge.seed, bridge.startPhase, client]);

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
          worn: bridge.worn(),
          swing: bridge.swing(),
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
  const settled = phase.kind === "offline" || phase.kind === "failed";
  const inRoom = settled ? tried && codeInUrl() !== null : true;
  return { client, session, targetId, dead: view.dead, watchingName, spectating: view.dead && !allDown, inRoom };
}
