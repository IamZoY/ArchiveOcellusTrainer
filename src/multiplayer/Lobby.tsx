/**
 * The co-op panel: open a room, read the six letters out to your friends, watch them arrive, and go when all are
 * ready. Once the fight is on it shrinks to a roster strip that shows who the boss is on and who is still up.
 */
import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { RoomClient } from "./client";
import type { Gear, Member, PlayerId } from "./protocol";
import { CODE_LENGTH, isRoomCode } from "./protocol";

export const LOBBY_CSS = `
#coop_panel { display: flex; flex-direction: column; gap: 7px; font-size: 13px; line-height: 1.35; }
#coop_panel .coop-row { display: flex; gap: 6px; align-items: center; }
#coop_panel input { flex: 1; min-width: 0; padding: 6px 8px; font: inherit; text-transform: uppercase; }
#coop_panel input.coop-name { text-transform: none; }
/* The sidebar is narrow, so these take a line of their own at a size a glance can find and a cursor can hit. */
#coop_panel button { display: block; width: 100%; min-height: 30px; padding: 7px 10px; font: inherit; cursor: pointer; }
#coop_panel .coop-row button { width: auto; flex: 0 0 auto; }
#coop_panel button:disabled { cursor: default; opacity: 0.55; }
#coop_panel .coop-code { font-size: 23px; letter-spacing: 5px; font-weight: bold; text-align: center; padding: 5px 2px; user-select: all; }
#coop_panel .coop-hint { opacity: 0.75; margin: 0; }
#coop_panel .coop-link { width: 100%; box-sizing: border-box; font-size: 11px; text-transform: none; user-select: all; }
#coop_panel .coop-error { color: #ff6b6b; margin: 0; }
#coop_panel ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
/* Name on its own line, tags under it: side by side they shred into stacks of two letters in a panel this narrow. */
#coop_panel li { display: flex; flex-direction: column; gap: 2px; }
#coop_panel li .coop-who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; }
#coop_panel .coop-tags { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
#coop_panel .coop-tag { font-size: 11px; white-space: nowrap; padding: 1px 5px; border-radius: 3px; background: rgba(255,255,255,0.15); }
#coop_panel .coop-ready { color: #7bd87b; }
#coop_panel .coop-waiting { opacity: 0.6; }
#coop_panel .coop-dead { opacity: 0.5; text-decoration: line-through; }
#coop_panel .coop-target { color: #ffb84d; }
#coop_panel .coop-gear { color: #9fd0ff; text-transform: capitalize; }
#spectate_banner {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  background: rgba(0,0,0,0.72); color: #fff; padding: 10px 16px; border-radius: 6px;
  text-align: center; pointer-events: none; z-index: 40;
}
#spectate_banner strong { display: block; font-size: 16px; }
`;

function useClient(client: RoomClient) {
  return useSyncExternalStore(
    useCallback((changed: () => void) => client.subscribe(changed), [client]),
    useCallback(() => client.phase(), [client]),
  );
}

const STORED_NAME = "archive-ocellus-coop-name";

function savedName(): string {
  try {
    return localStorage.getItem(STORED_NAME) ?? "";
  } catch {
    return "";
  }
}

function remember(name: string): void {
  try {
    localStorage.setItem(STORED_NAME, name);
  } catch {
    // a private window refuses storage; the name just will not be remembered
  }
}

/** The code in the address bar, so a friend can be sent a link instead of six letters. */
export function codeInUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
  return isRoomCode(raw) ? raw : null;
}

/**
 * Keeps the address bar on the room and the fight it is running, so reloading this page comes back to both rather
 * than to a fresh seed of its own, and so the link in it is one a friend can be sent.
 */
function putRoomInUrl(room: Readonly<{ code: string; seed: number; startPhase: number }> | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (room === null) {
    url.searchParams.delete("room");
  } else {
    url.searchParams.set("room", room.code);
    url.searchParams.set("seed", String(room.seed));
    url.searchParams.set("phase", String(room.startPhase));
  }
  window.history.replaceState(null, "", url);
}

/**
 * The link a friend opens to land in this room, on this fight, with the host's settings. The kit is left out: that
 * part of the address bar is personal, and a link that overwrote it would hand everyone the host's loadout.
 */
export function fightLink(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("tier");
  url.searchParams.delete("weapon");
  return url.toString();
}

/** Names in a sentence, as a person would read them out. */
function spoken(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/** What a page sitting in a room is waiting for, said in the names of the people it is waiting on. */
export function waitingOn(roster: readonly Member[], you: PlayerId): string {
  const unready = roster.filter((member) => !member.ready);
  if (unready.length === 0) return "Everyone is ready.";
  return `Waiting for ${spoken(unready.map((member) => (member.id === you ? "you" : member.name)))}.`;
}

/**
 * Copies the link, or shows it to be copied by hand. A page served over plain http, which a fight hosted on a box
 * of one's own usually is, has no clipboard to write to, and a link nobody can copy is worse than one on screen.
 */
function ShareLink() {
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    const link = fightLink(window.location.href);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setShown(null);
    } catch {
      setShown(link);
    }
  };

  return (
    <>
      <button type="button" id="coop_link" onClick={() => void copy()}>
        {copied ? "Link copied" : "Copy link"}
      </button>
      {shown !== null && <input className="coop-link" readOnly aria-label="Fight link" value={shown} onFocus={(event) => event.target.select()} />}
    </>
  );
}

/**
 * What a page in a room shows in place of its own Start: the fight is the room's, so this says who it is still
 * waiting on. The host gets the button, because the host is the one everyone else is waiting for.
 */
export function CoopWaiting({ client }: Readonly<{ client: RoomClient }>) {
  const phase = useClient(client);
  if (phase.kind === "connecting") {
    return (
      <section id="coop_wait" role="dialog" aria-labelledby="coop_wait_title">
        <h2 id="coop_wait_title">Joining…</h2>
        <p>Finding the room.</p>
      </section>
    );
  }
  if (phase.kind !== "lobby" || phase.running) return null;
  const { roster, connection } = phase;
  const ready = roster.find((member) => member.id === connection.you)?.ready === true;
  const allReady = roster.length > 0 && roster.every((member) => member.ready);
  return (
    <section id="coop_wait" role="dialog" aria-labelledby="coop_wait_title">
      <h2 id="coop_wait_title">{connection.host ? "Your party" : "Waiting for the party"}</h2>
      <p>
        {waitingOn(roster, connection.you)}
        {!connection.host && allReady ? " The host starts the fight." : ""}
      </p>
      <button type="button" id="coop_wait_ready" onClick={() => client.setReady(!ready)}>
        {ready ? "Not ready" : "I am ready"}
      </button>
      {connection.host && (
        <button type="button" id="coop_wait_start" disabled={!allReady} onClick={() => client.start()}>
          Start the fight
        </button>
      )}
    </section>
  );
}

function Roster({ roster, you, targetId }: Readonly<{ roster: readonly Member[]; you: PlayerId; targetId: PlayerId | null }>) {
  return (
    <ul>
      {roster.map((member) => (
        <li key={member.id} className={member.dead ? "coop-dead" : undefined}>
          <span className="coop-who">
            {member.name}
            {member.id === you ? " (you)" : ""}
          </span>
          <span className="coop-tags">
            {member.gear !== null && <span className="coop-tag coop-gear">{member.gear.edited ? `${member.gear.tier}*` : member.gear.tier}</span>}
            {member.id === targetId && !member.dead && <span className="coop-tag coop-target">boss</span>}
            {member.host && <span className="coop-tag">host</span>}
            <span className={member.ready ? "coop-ready" : "coop-waiting"}>{member.dead ? "dead" : member.ready ? "ready" : "waiting"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CoopPanel({ client, seed, startPhase, targetId, gear }: Readonly<{ client: RoomClient; seed: number; startPhase: number; targetId: PlayerId | null; gear: Gear }>) {
  const phase = useClient(client);
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(() => codeInUrl() ?? "");
  // Ready is read off the roster rather than remembered here: a reload between runs forgets a local flag while the
  // room still holds the seat, and the button would then offer to do what has already been done.
  const seated = phase.kind === "lobby" || phase.kind === "fighting" ? phase.roster.find((member) => member.id === phase.connection.you) : undefined;
  const ready = seated?.ready === true;

  useEffect(() => {
    if (phase.kind === "lobby" || phase.kind === "fighting") putRoomInUrl(phase.connection);
  }, [phase]);

  const worn = `${gear.tier}:${gear.weapon ?? "-"}:${gear.edited}`;
  useEffect(() => {
    if (phase.kind !== "lobby") return;
    client.setGear(gear);
    // Only a change of kit matters here, which `worn` names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worn, phase.kind, client]);

  const named = name.trim().length > 0;

  switch (phase.kind) {
    case "connecting":
      return <div id="coop_panel">Connecting…</div>;

    case "failed":
      return (
        <div id="coop_panel">
          <p className="coop-error">{phase.error}</p>
          {/* The code goes out of the address bar too, or this page would keep trying to be in that room. */}
          <button type="button" onClick={() => { putRoomInUrl(null); client.leave(); }}>
            Back
          </button>
        </div>
      );

    case "offline":
      return (
        <div id="coop_panel">
          <div className="coop-row">
            <input
              className="coop-name"
              aria-label="Your name"
              placeholder="Your name"
              value={name}
              maxLength={12}
              onChange={(event) => {
                setName(event.target.value);
                remember(event.target.value);
              }}
            />
          </div>
          <button type="button" id="coop_host" disabled={!named} onClick={() => void client.open(name.trim(), seed, startPhase, gear)}>
            Host a fight
          </button>
          <p className="coop-hint">or join one:</p>
          <div className="coop-row">
            <input
              aria-label="Room code"
              placeholder="CODE"
              value={code}
              maxLength={CODE_LENGTH}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            <button type="button" id="coop_join" disabled={!named || !isRoomCode(code)} onClick={() => void client.join(code, name.trim(), gear)}>
              Join
            </button>
          </div>
        </div>
      );

    case "lobby": {
      const everyone = phase.roster;
      const allReady = everyone.length > 0 && everyone.every((member) => member.ready);
      return (
        <div id="coop_panel">
          <div className="coop-code" id="coop_code">
            {phase.connection.code}
          </div>
          <p className="coop-hint">{phase.running ? "That fight is already under way." : "Give these six letters to your friends, or send them the link."}</p>
          <ShareLink />
          <Roster roster={everyone} you={phase.connection.you} targetId={null} />
          <button type="button" id="coop_ready" onClick={() => client.setReady(!ready)}>
            {ready ? "Not ready" : "Ready"}
          </button>
          {/* A fight runs off its seed from tick one, so nobody joins one halfway. Starting it over is the way in. */}
          {phase.running && phase.connection.host && (
            <button type="button" id="coop_restart" onClick={() => client.again()}>
              Restart the fight
            </button>
          )}
          {phase.running && !phase.connection.host && <p className="coop-hint">You are in from the next run; the host can start it over.</p>}
          {!phase.running && phase.connection.host && (
            <button type="button" id="coop_start" disabled={!allReady} onClick={() => client.start()}>
              {allReady ? "Start the fight" : "Waiting for everyone"}
            </button>
          )}
          {!phase.running && !phase.connection.host && <p className="coop-hint">The host starts the fight.</p>}
          <button type="button" onClick={() => { putRoomInUrl(null); client.leave(); }}>
            Leave
          </button>
        </div>
      );
    }

    case "fighting":
      return (
        <div id="coop_panel">
          <Roster roster={phase.roster} you={phase.connection.you} targetId={targetId} />
          <ShareLink />
          {phase.connection.host && (
            <button type="button" id="coop_again" onClick={() => client.again()}>
              Run it again
            </button>
          )}
          {!phase.connection.host && <p className="coop-hint">The host can run it again from here.</p>}
          <button type="button" onClick={() => { putRoomInUrl(null); client.leave(); }}>
            Leave
          </button>
        </div>
      );

    default: {
      const unhandled: never = phase;
      return unhandled;
    }
  }
}

export function SpectateBanner({ watching }: Readonly<{ watching: string | null }>) {
  return (
    <div id="spectate_banner" role="status">
      <strong>You died.</strong>
      {watching === null ? "Waiting for someone to watch…" : `Watching ${watching}.`}
    </div>
  );
}
