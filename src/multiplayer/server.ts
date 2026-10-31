/**
 * The room server, for a VPS: it serves the built site and relays one fight between the people in a room.
 *
 * It holds no fight of its own. The host's browser decides what every hit did; this only carries words between
 * machines and enforces who is allowed to say them. Rooms live in memory, so a restart ends every fight.
 *
 *   node --experimental-strip-types src/multiplayer/server.ts --port 8080 --dist dist
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomFillSync } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { PlayerId, RoomCode, ServerEvent } from "./protocol";
import { HEARTBEAT_MS, START_PHASES, encodeEvent, isRoomCode, parseAuthority, parseGear, parseIntent, parseName, parsePlayerState, parseSetup } from "./protocol";
import type { Room } from "./rooms";
import { Rooms, drainStates, randomFrom, rosterOf, why } from "./rooms";

const MAX_BODY_BYTES = 8192;

/** The server dresses nobody, so it only checks these are names a build could know, not that they suit each other. */
const TIERS = ["raid", "max", "high", "mid", "low", "poor"];
const WEAPONS = ["twistedBow", "blowpipe", "melee", "ralos"];

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
};

type Stream = Readonly<{ id: PlayerId; code: RoomCode; response: ServerResponse }>;

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  return value ?? fallback;
}

function bytes(n: number): Uint8Array {
  return randomFillSync(new Uint8Array(n));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += String(chunk);
    if (raw.length > MAX_BODY_BYTES) throw new Error("body too large");
  }
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("body is not JSON");
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(text);
}

const field = (raw: unknown, key: string): unknown => (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? Reflect.get(raw, key) : undefined);
const asText = (raw: unknown): string => (typeof raw === "string" ? raw : "");

export type ServerOptions = Readonly<{ heartbeatMs?: number; staleMs?: number; reclaimAfterMs?: number }>;

export function createRoomServer(distDir: string, options: ServerOptions = {}) {
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const rooms = new Rooms(randomFrom(bytes));
  const streams = new Set<Stream>();
  /**
   * Rooms with something to say, sent at the end of the turn that heard it. Pooling by a timer instead would hold
   * every report for part of its window, and a tile held back is a step everyone else takes late: the room sits
   * between two machines that are each on their own 600ms tick, so the only delay worth keeping here is none.
   */
  const dirty = new Set<RoomCode>();
  let flushing = false;

  function publish(code: RoomCode, event: ServerEvent, except?: PlayerId): void {
    const frame = encodeEvent(event);
    for (const stream of streams) {
      if (stream.code !== code || stream.id === except) continue;
      stream.response.write(frame);
    }
  }

  const announce = (room: Room) => publish(room.code, { kind: "roster", roster: rosterOf(room) });

  function flush(): void {
    flushing = false;
    for (const code of dirty) {
      const room = rooms.get(code);
      if (!room) continue;
      const states = drainStates(room);
      if (states.length > 0) publish(code, { kind: "states", states });
    }
    dirty.clear();
  }

  /** Everything heard in this turn of the loop goes out together, which is as soon as it can go out at all. */
  function soon(code: RoomCode): void {
    dirty.add(code);
    if (flushing) return;
    flushing = true;
    setImmediate(flush);
  }

  /**
   * An open stream is what it means to be present. Waiting in a lobby sends nothing, so without this the sweeper
   * would drop everyone a few seconds in and take the room with them.
   */
  function heartbeat(): void {
    const now = Date.now();
    for (const stream of streams) rooms.touch(stream.code, stream.id, now);
    for (const room of rooms.sweep(now, options.staleMs)) announce(room);
    for (const stream of streams) stream.response.write(encodeEvent({ kind: "ping" }));
  }

  const beater = setInterval(heartbeat, heartbeatMs);
  beater.unref?.();

  function openStream(request: IncomingMessage, response: ServerResponse, code: RoomCode, url: URL): void {
    const id = asText(url.searchParams.get("playerId"));
    const token = asText(url.searchParams.get("token"));
    const room = rooms.get(code);
    if (!room) return send(response, 404, { error: "no room with that code" });
    const seat = room.seats.get(id);
    if (!seat || seat.token !== token) return send(response, 403, { error: "that seat is not yours" });

    // Small frames, one a tick: without this they wait on Nagle for an acknowledgement that is not coming, which
    // is tens of milliseconds added to every step a friend takes.
    request.socket.setNoDelay(true);
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const stream: Stream = { id, code, response };
    streams.add(stream);
    rooms.touch(code, id, Date.now());

    // No `start` for a stream that opens mid-fight, however it got here. The fight runs off its seed from tick one
    // and there is no joining it halfway; the welcome says it is on, and the client waits for the next run.
    response.write(encodeEvent({ kind: "welcome", you: id, code, seed: room.seed, startPhase: room.startPhase, roster: rosterOf(room), started: room.started }));
    announce(room);

    // A closed stream is not a departure. A reload closes one and opens another a second later, and dropping the
    // seat in between would hand the host's seat to someone else and lose everyone's ready. The seat is held until
    // the stale sweep gives up on it, which is also what a dropped connection deserves.
    const close = () => {
      if (!streams.delete(stream)) return;
      const room = rooms.get(code);
      if (room) announce(room);
    };
    request.on("close", close);
    request.on("error", close);
  }

  async function api(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const parts = url.pathname.split("/").filter(Boolean).slice(1);
    const now = Date.now();

    if (parts[0] === "rooms" && parts.length === 1 && request.method === "POST") {
      const body = await readBody(request);
      const name = parseName(field(body, "name"));
      if (name === null) return send(response, 400, { error: "a name is needed" });
      const setup = parseSetup(field(body, "seed"), field(body, "startPhase"));
      if (setup === null) return send(response, 400, { error: `a 32-bit seed and a phase of ${START_PHASES.join(", ")} are needed` });
      const { room, seat } = rooms.open(name, setup.seed, setup.startPhase, now, parseGear(field(body, "gear"), TIERS, WEAPONS));
      return send(response, 200, { code: room.code, playerId: seat.id, token: seat.token, seed: room.seed, startPhase: room.startPhase, host: true });
    }

    const code = parts[1];
    if (parts[0] !== "rooms" || code === undefined || !isRoomCode(code)) return send(response, 404, { error: "unknown route" });
    const action = parts[2];

    if (action === "events" && request.method === "GET") return openStream(request, response, code, url);

    if (request.method !== "POST") return send(response, 405, { error: "POST only" });
    const body = await readBody(request);

    if (action === "join") {
      const name = parseName(field(body, "name"));
      if (name === null) return send(response, 400, { error: "a name is needed" });
      const joined = rooms.join(code, name, now, parseGear(field(body, "gear"), TIERS, WEAPONS), options.reclaimAfterMs);
      if (!joined.ok) return send(response, 409, { error: why(joined.why) });
      announce(joined.value.room);
      const { room, seat } = joined.value;
      return send(response, 200, { code: room.code, playerId: seat.id, token: seat.token, seed: room.seed, startPhase: room.startPhase, host: false });
    }

    const id = asText(field(body, "playerId"));
    const token = asText(field(body, "token"));

    switch (action) {
      case "ready": {
        const set = rooms.setReady(code, id, token, field(body, "ready") === true, now);
        if (!set.ok) return send(response, 403, { error: why(set.why) });
        announce(set.value);
        return send(response, 200, { ok: true });
      }
      case "gear": {
        const dressed = rooms.setGear(code, id, token, parseGear(field(body, "gear"), TIERS, WEAPONS), now);
        if (!dressed.ok) return send(response, 403, { error: why(dressed.why) });
        announce(dressed.value);
        return send(response, 200, { ok: true });
      }
      case "setup": {
        const setup = parseSetup(field(body, "seed"), field(body, "startPhase"));
        if (setup === null) return send(response, 400, { error: "that fight does not parse" });
        const moved = rooms.setup(code, id, token, setup.seed, setup.startPhase, now);
        if (!moved.ok) return send(response, 409, { error: why(moved.why) });
        publish(code, { kind: "setup", seed: moved.value.seed, startPhase: moved.value.startPhase });
        return send(response, 200, { ok: true });
      }
      case "start": {
        const started = rooms.start(code, id, token, now);
        if (!started.ok) return send(response, 409, { error: why(started.why) });
        publish(code, { kind: "start", seed: started.value.seed, startPhase: started.value.startPhase, at: started.value.startedAt ?? now, run: started.value.runs });
        return send(response, 200, { ok: true });
      }
      case "state": {
        const state = parsePlayerState(body, id);
        if (state === null) return send(response, 400, { error: "that state does not parse" });
        const already = rooms.get(code)?.seats.get(id)?.dead === true;
        const reported = rooms.report(code, id, token, state, now);
        if (!reported.ok) return send(response, 403, { error: why(reported.why) });
        soon(code);
        // A death is roster news, not just another frame: it is what takes someone off the boss and out of the
        // list, and the client that died has stopped ticking and will not be saying it twice.
        if (state.dead && !already) announce(reported.value);
        return send(response, 200, { ok: true });
      }
      case "intent": {
        const intent = parseIntent(field(body, "intent"));
        if (intent === null) return send(response, 400, { error: "that intent does not parse" });
        const relayed = rooms.relay(code, id, token, intent, now);
        if (!relayed.ok) return send(response, 403, { error: why(relayed.why) });
        publish(code, relayed.value.event, id);
        return send(response, 200, { ok: true });
      }
      case "authority": {
        const authority = parseAuthority(field(body, "authority"));
        if (authority === null) return send(response, 400, { error: "that authority does not parse" });
        const judged = rooms.judge(code, id, token, authority, now);
        if (!judged.ok) return send(response, 403, { error: why(judged.why) });
        publish(code, { kind: "authority", authority }, id);
        if (authority.deaths.length > 0) announce(judged.value);
        return send(response, 200, { ok: true });
      }
      case "again": {
        // A seed and a phase are optional here: without them the room runs the fight it is already on again.
        const asked = field(body, "seed") === undefined ? null : parseSetup(field(body, "seed"), field(body, "startPhase"));
        if (field(body, "seed") !== undefined && asked === null) return send(response, 400, { error: "that fight does not parse" });
        const again = rooms.restart(code, id, token, now, asked);
        if (!again.ok) return send(response, 409, { error: why(again.why) });
        // The setup goes first, so every client has the fight before it is told to go back for it.
        if (asked !== null) publish(code, { kind: "setup", seed: again.value.seed, startPhase: again.value.startPhase });
        publish(code, { kind: "regroup", run: again.value.runs });
        announce(again.value);
        return send(response, 200, { ok: true });
      }
      case "leave": {
        const left = rooms.leave(code, id, token);
        if (!left.ok) return send(response, 403, { error: why(left.why) });
        announce(left.value);
        return send(response, 200, { ok: true });
      }
      default:
        return send(response, 404, { error: "unknown route" });
    }
  }

  /** The built site, with any unknown path falling back to the one page so a deep link still loads. */
  function serveFile(response: ServerResponse, url: URL): void {
    const root = resolve(distDir);
    const asked = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/u, "");
    const candidate = resolve(join(root, asked));
    const inside = candidate === root || candidate.startsWith(root + sep);
    const file = inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
    if (!existsSync(file)) return send(response, 404, { error: "nothing built; run npm run build first" });
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    const immutable = /\.[0-9a-f]{16,}\./u.test(file);
    response.writeHead(200, { "content-type": type, "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
    createReadStream(file).pipe(response);
  }

  const server = createServer((request, response) => {
    request.socket.setNoDelay(true);
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (!url.pathname.startsWith("/mp/")) {
      if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, { error: "GET only" });
      return serveFile(response, url);
    }
    api(request, response, url).catch((error: unknown) => {
      if (!response.headersSent) send(response, 400, { error: error instanceof Error ? error.message : "bad request" });
    });
  });

  const stop = () => {
    clearInterval(beater);
    for (const stream of streams) stream.response.end();
    streams.clear();
    server.close();
  };

  return { server, rooms, stop };
}

const entry = (process.argv[1] ?? "").replace(/\\/gu, "/").split("/").pop() ?? "";
if (entry === "server.ts" || entry === "server.js" || entry === "server.mjs") {
  const port = Number(option("port", "8080"));
  const dist = option("dist", "dist");
  const { server } = createRoomServer(dist);
  server.listen(port, () => console.log(`ocellus room server on http://0.0.0.0:${port}, serving ${resolve(dist)}`));
}
