/**
 * The co-op panel: open a room, read the six letters out to your friends, watch them arrive, and go when all are
 * ready. Once the fight is on it shrinks to a roster strip that shows who the boss is on and who is still up.
 */
import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { RoomClient } from "./client";
import type { Gear, Member, PlayerId } from "./protocol";
import { CODE_LENGTH, isRoomCode } from "./protocol";

export const LOBBY_CSS = `
#coop_panel { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
#coop_panel .coop-row { display: flex; gap: 6px; align-items: center; }
#coop_panel input { flex: 1; min-width: 0; padding: 3px 5px; font: inherit; text-transform: uppercase; }
#coop_panel input.coop-name { text-transform: none; }
#coop_panel button { padding: 3px 8px; font: inherit; cursor: pointer; }
#coop_panel .coop-code { font-size: 20px; letter-spacing: 5px; font-weight: bold; text-align: center; padding: 4px; user-select: all; }
#coop_panel .coop-hint { opacity: 0.75; }
#coop_panel .coop-error { color: #ff6b6b; }
#coop_panel ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
#coop_panel li { display: flex; gap: 6px; align-items: center; justify-content: space-between; }
#coop_panel li .coop-who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#coop_panel .coop-tag { font-size: 10px; padding: 0 4px; border-radius: 3px; background: rgba(255,255,255,0.15); }
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

function putCodeInUrl(code: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (code === null) url.searchParams.delete("room");
  else url.searchParams.set("room", code);
  window.history.replaceState(null, "", url);
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
          <span className="coop-row">
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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (phase.kind === "lobby" || phase.kind === "fighting") putCodeInUrl(phase.connection.code);
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
          <button type="button" onClick={() => client.leave()}>
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
          <p className="coop-hint">Give these six letters to your friends.</p>
          <Roster roster={everyone} you={phase.connection.you} targetId={null} />
          <button
            type="button"
            id="coop_ready"
            onClick={() => {
              const next = !ready;
              setReady(next);
              client.setReady(next);
            }}
          >
            {ready ? "Not ready" : "Ready"}
          </button>
          {phase.connection.host && (
            <button type="button" id="coop_start" disabled={!allReady} onClick={() => client.start()}>
              {allReady ? "Start the fight" : "Waiting for everyone"}
            </button>
          )}
          {!phase.connection.host && <p className="coop-hint">The host starts the fight.</p>}
          <button type="button" onClick={() => { putCodeInUrl(null); client.leave(); }}>
            Leave
          </button>
        </div>
      );
    }

    case "fighting":
      return (
        <div id="coop_panel">
          <Roster roster={phase.roster} you={phase.connection.you} targetId={targetId} />
          <button type="button" onClick={() => { putCodeInUrl(null); client.leave(); }}>
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
