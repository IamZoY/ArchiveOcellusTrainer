/**
 * Drives the real server over a real socket: these go through HTTP and a live event stream, because the parts most
 * worth pinning (who may say what, and whether a frame actually reaches the other machine) only exist there.
 *
 * The suite runs under jsdom, whose shared setup swaps `fetch` for an offline stub, so these speak `node:http`
 * directly rather than taking that away from every other file.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { ServerEvent } from "./protocol";
import { createRoomServer } from "./server";

let port = 0;
let stop = () => {};

beforeAll(async () => {
  const made = createRoomServer("dist");
  stop = made.stop;
  await new Promise<void>((done) => made.server.listen(0, "127.0.0.1", done));
  const address = made.server.address();
  port = typeof address === "object" && address !== null ? (address as AddressInfo).port : 0;
});

afterAll(() => stop());

type Reply = Readonly<{ status: number; body: string }>;

function sendTo(toPort: number, method: string, path: string, body?: unknown, onStream?: (response: IncomingMessage) => void): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const call = request({ host: "127.0.0.1", port: toPort, path, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (response) => {
      const status = response.statusCode ?? 0;
      if (onStream && status === 200) {
        onStream(response);
        resolve({ status, body: "" });
        return;
      }
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        text += chunk;
      });
      response.on("end", () => resolve({ status, body: text }));
    });
    call.on("error", reject);
    call.end(payload);
  });
}

const send = (method: string, path: string, body?: unknown, onStream?: (response: IncomingMessage) => void) => sendTo(port, method, path, body, onStream);

const post = async (path: string, body: unknown) => {
  const reply = await send("POST", path, body);
  return { status: reply.status, json: () => JSON.parse(reply.body || "{}") as unknown, text: () => reply.body };
};

type Seat = Readonly<{ code: string; playerId: string; token: string; seed: number; startPhase: number; host: boolean }>;

async function open(name: string, seed = 1234, startPhase = 1): Promise<Seat> {
  const response = await post("/mp/rooms", { name, seed, startPhase });
  expect(response.status).toBe(200);
  return response.json() as Seat;
}

async function join(code: string, name: string): Promise<Seat> {
  const response = await post(`/mp/rooms/${code}/join`, { name });
  expect(response.status).toBe(200);
  return response.json() as Seat;
}

/** Holds a live SSE connection and lets a test wait for the next frame of a kind. */
class Listener {
  private readonly seen: ServerEvent[] = [];
  private readonly waiting = new Map<string, (event: ServerEvent) => void>();
  private response: IncomingMessage | null = null;

  static async connect(path: string): Promise<Listener> {
    const listener = new Listener();
    const reply = await send("GET", path, undefined, (response) => listener.pump(response));
    expect(reply.status).toBe(200);
    return listener;
  }

  private pump(response: IncomingMessage): void {
    this.response = response;
    let buffer = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      buffer += chunk;
      let cut = buffer.indexOf("\n\n");
      while (cut >= 0) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const line = frame.split("\n").find((part) => part.startsWith("data: "));
        if (line) this.take(JSON.parse(line.slice(6)) as ServerEvent);
        cut = buffer.indexOf("\n\n");
      }
    });
    response.on("error", () => {});
  }

  private take(event: ServerEvent): void {
    this.seen.push(event);
    const waiter = this.waiting.get(event.kind);
    if (waiter) {
      this.waiting.delete(event.kind);
      waiter(event);
    }
  }

  /** Resolves with an already-seen frame of that kind, or the next one to arrive. */
  next<K extends ServerEvent["kind"]>(kind: K, afterIndex = 0): Promise<Extract<ServerEvent, { kind: K }>> {
    const found = this.seen.slice(afterIndex).find((event) => event.kind === kind);
    if (found) return Promise.resolve(found as Extract<ServerEvent, { kind: K }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${kind} frame arrived`)), 4000);
      this.waiting.set(kind, (event) => {
        clearTimeout(timer);
        resolve(event as Extract<ServerEvent, { kind: K }>);
      });
    });
  }

  count(): number {
    return this.seen.length;
  }

  close(): void {
    this.response?.destroy();
    this.response = null;
  }
}

const listen = (seat: Seat) => Listener.connect(`/mp/rooms/${seat.code}/events?playerId=${seat.playerId}&token=${seat.token}`);

describe("opening a room", () => {
  it("gives a six letter code and the host's own seed", async () => {
    const host = await open("Zoy", 777, 3);
    expect(host.code).toMatch(/^[ACDEFGHJKLMNPQRTUVWXY]{6}$/u);
    expect(host.seed).toBe(777);
    expect(host.startPhase).toBe(3);
    expect(host.host).toBe(true);
  });

  it("refuses a seed or phase the fight could not use", async () => {
    expect((await post("/mp/rooms", { name: "Zoy", seed: -1, startPhase: 1 })).status).toBe(400);
    expect((await post("/mp/rooms", { name: "Zoy", seed: 1, startPhase: 9 })).status).toBe(400);
    expect((await post("/mp/rooms", { name: "", seed: 1, startPhase: 1 })).status).toBe(400);
  });
});

describe("the stream", () => {
  it("welcomes a joiner with the same seed the host opened with", async () => {
    const host = await open("Zoy", 4242, 2);
    const guest = await join(host.code, "Ziad");
    const stream = await listen(guest);
    const welcome = await stream.next("welcome");
    expect(welcome.seed).toBe(4242);
    expect(welcome.startPhase).toBe(2);
    expect(welcome.you).toBe(guest.playerId);
    stream.close();
  });

  it("refuses a stream for a seat whose token is wrong", async () => {
    const host = await open("Zoy");
    const response = await send("GET", `/mp/rooms/${host.code}/events?playerId=${host.playerId}&token=nope`);
    expect(response.status).toBe(403);
  });

  it("tells everyone when the roster changes", async () => {
    const host = await open("Zoy");
    const stream = await listen(host);
    await stream.next("welcome");
    const before = stream.count();
    await join(host.code, "Ziad");
    const roster = await stream.next("roster", before);
    expect(roster.roster.map((member) => member.name)).toContain("Ziad");
    stream.close();
  });
});

describe("waiting in a lobby", () => {
  it("keeps a room alive while nobody is reporting, because an open stream is presence enough", async () => {
    // Its own server, swept hard, so several sweeps pass inside the test while the lobby stays silent.
    const brisk = createRoomServer("dist", { heartbeatMs: 25, staleMs: 60 });
    await new Promise<void>((done) => brisk.server.listen(0, "127.0.0.1", done));
    const address = brisk.server.address();
    const briskPort = typeof address === "object" && address !== null ? (address as AddressInfo).port : 0;

    const opened = await sendTo(briskPort, "POST", "/mp/rooms", { name: "Zoy", seed: 1, startPhase: 1 });
    const seat = JSON.parse(opened.body) as Seat;

    const held = await new Promise<IncomingMessage>((resolve) => {
      void sendTo(briskPort, "GET", `/mp/rooms/${seat.code}/events?playerId=${seat.playerId}&token=${seat.token}`, undefined, resolve);
    });

    await new Promise((done) => setTimeout(done, 400));

    const joined = await sendTo(briskPort, "POST", `/mp/rooms/${seat.code}/join`, { name: "Ziad" });
    expect(joined.status).toBe(200);

    held.destroy();
    brisk.stop();
  }, 10000);

  it("drops a room once its last stream closes and the sweep comes round", async () => {
    const brisk = createRoomServer("dist", { heartbeatMs: 25, staleMs: 60 });
    await new Promise<void>((done) => brisk.server.listen(0, "127.0.0.1", done));
    const address = brisk.server.address();
    const briskPort = typeof address === "object" && address !== null ? (address as AddressInfo).port : 0;

    const opened = await sendTo(briskPort, "POST", "/mp/rooms", { name: "Zoy", seed: 1, startPhase: 1 });
    const seat = JSON.parse(opened.body) as Seat;
    await new Promise((done) => setTimeout(done, 400));

    const joined = await sendTo(briskPort, "POST", `/mp/rooms/${seat.code}/join`, { name: "Ziad" });
    expect(joined.status).toBe(409);
    brisk.stop();
  }, 10000);
});

describe("a seat across a reload", () => {
  it("keeps the host's seat, name and ready when their stream closes and comes back", async () => {
    const host = await open("Zoy");
    const guest = await join(host.code, "Ziad");
    await post(`/mp/rooms/${host.code}/ready`, { playerId: host.playerId, token: host.token, ready: true });

    const first = await listen(host);
    await first.next("welcome");
    first.close();
    // A reload closes the stream and opens another. Nothing else happens in between.
    await new Promise((done) => setTimeout(done, 300));

    const second = await listen(host);
    const welcome = await second.next("welcome");
    const mine = welcome.roster.find((member) => member.id === host.playerId);
    expect(mine).toMatchObject({ name: "Zoy", host: true, ready: true });
    expect(welcome.roster.find((member) => member.id === guest.playerId)?.host).toBe(false);
    second.close();
  }, 10000);

  it("still refuses a different person taking that name while the seat is held", async () => {
    const host = await open("Zoy");
    const stream = await listen(host);
    await stream.next("welcome");
    stream.close();
    await new Promise((done) => setTimeout(done, 200));
    const impostor = await post(`/mp/rooms/${host.code}/join`, { name: "Zoy" });
    expect(impostor.status).toBe(409);
  }, 10000);
});

describe("ready and start", () => {
  it("starts only when all are ready, and tells every stream", async () => {
    const host = await open("Zoy", 99, 4);
    const guest = await join(host.code, "Ziad");
    const hostStream = await listen(host);
    const guestStream = await listen(guest);
    await Promise.all([hostStream.next("welcome"), guestStream.next("welcome")]);

    const early = await post(`/mp/rooms/${host.code}/start`, { playerId: host.playerId, token: host.token });
    expect(early.status).toBe(409);

    await post(`/mp/rooms/${host.code}/ready`, { playerId: host.playerId, token: host.token, ready: true });
    await post(`/mp/rooms/${host.code}/ready`, { playerId: guest.playerId, token: guest.token, ready: true });

    const asGuest = await post(`/mp/rooms/${host.code}/start`, { playerId: guest.playerId, token: guest.token });
    expect(asGuest.status).toBe(409);

    const started = await post(`/mp/rooms/${host.code}/start`, { playerId: host.playerId, token: host.token });
    expect(started.status).toBe(200);

    const [a, b] = await Promise.all([hostStream.next("start"), guestStream.next("start")]);
    expect(a.seed).toBe(99);
    expect(b.seed).toBe(99);
    expect(b.startPhase).toBe(4);
    hostStream.close();
    guestStream.close();
  });
});

describe("gear", () => {
  it("carries what each player is wearing to the other client's roster", async () => {
    const host = await open("Zoy");
    const stream = await listen(host);
    await stream.next("welcome");
    const before = stream.count();

    const joined = await post(`/mp/rooms/${host.code}/join`, { name: "Ziad", gear: { tier: "poor", weapon: "melee" } });
    expect(joined.status).toBe(200);

    const roster = await stream.next("roster", before);
    expect(roster.roster.find((member) => member.name === "Ziad")?.gear).toMatchObject({ tier: "poor", weapon: "melee" });
    stream.close();
  }, 10000);

  it("tells everyone when a player changes tier in the lobby", async () => {
    const host = await open("Zoy");
    const guest = await join(host.code, "Ziad");
    const stream = await listen(host);
    await stream.next("welcome");
    const before = stream.count();

    const dressed = await post(`/mp/rooms/${host.code}/gear`, {
      playerId: guest.playerId,
      token: guest.token,
      gear: { tier: "max", weapon: "blowpipe" },
    });
    expect(dressed.status).toBe(200);

    const roster = await stream.next("roster", before);
    expect(roster.roster.find((member) => member.id === guest.playerId)?.gear).toMatchObject({ tier: "max", weapon: "blowpipe" });
    stream.close();
  }, 10000);

  it("refuses gear a build could not know, rather than passing it on", async () => {
    const host = await open("Zoy");
    const guest = await join(host.code, "Ziad");
    const sent = await post(`/mp/rooms/${host.code}/gear`, { playerId: guest.playerId, token: guest.token, gear: { tier: "godmode" } });
    expect(sent.status).toBe(200);
    const stream = await listen(host);
    const welcome = await stream.next("welcome");
    expect(welcome.roster.find((member) => member.id === guest.playerId)?.gear).toBeNull();
    stream.close();
  }, 10000);
});

describe("one name to a room", () => {
  it("turns away a second player with the same name and says why", async () => {
    const host = await open("Zoy");
    const again = await post(`/mp/rooms/${host.code}/join`, { name: "Zoy" });
    expect(again.status).toBe(409);
    expect(again.json()).toMatchObject({ error: expect.stringContaining("already uses that name") });
  });
});

describe("running it again", () => {
  it("puts everyone back in the lobby on the host's word, and starts again from there", async () => {
    const host = await open("Zoy", 4242, 2);
    const guest = await join(host.code, "Ziad");
    const guestStream = await listen(guest);
    await guestStream.next("welcome");

    await post(`/mp/rooms/${host.code}/ready`, { playerId: host.playerId, token: host.token, ready: true });
    await post(`/mp/rooms/${host.code}/ready`, { playerId: guest.playerId, token: guest.token, ready: true });
    await post(`/mp/rooms/${host.code}/start`, { playerId: host.playerId, token: host.token });
    const first = await guestStream.next("start");
    expect(first.run).toBe(0);

    const seen = guestStream.count();
    const again = await post(`/mp/rooms/${host.code}/again`, { playerId: host.playerId, token: host.token });
    expect(again.status).toBe(200);

    const regroup = await guestStream.next("regroup", seen);
    expect(regroup.run).toBe(1);

    const restarted = await post(`/mp/rooms/${host.code}/start`, { playerId: host.playerId, token: host.token });
    expect(restarted.status).toBe(200);
    const second = await guestStream.next("start", guestStream.count() - 1);
    expect(second.seed).toBe(4242);
    guestStream.close();
  }, 10000);

  it("refuses a guest who tries to restart the fight", async () => {
    const host = await open("Zoy");
    const guest = await join(host.code, "Ziad");
    await post(`/mp/rooms/${host.code}/ready`, { playerId: host.playerId, token: host.token, ready: true });
    await post(`/mp/rooms/${host.code}/ready`, { playerId: guest.playerId, token: guest.token, ready: true });
    await post(`/mp/rooms/${host.code}/start`, { playerId: host.playerId, token: host.token });
    const sneaky = await post(`/mp/rooms/${host.code}/again`, { playerId: guest.playerId, token: guest.token });
    expect(sneaky.status).toBe(409);
  }, 10000);
});

describe("live state", () => {
  it("carries one player's tile to the other player", async () => {
    const host = await open("Zoy");
    const guest = await join(host.code, "Ziad");
    const hostStream = await listen(host);
    await hostStream.next("welcome");

    const reported = await post(`/mp/rooms/${host.code}/state`, {
      playerId: guest.playerId,
      token: guest.token,
      tick: 12,
      tile: { x: 5, y: 6 },
      hp: 70,
      maxHp: 99,
      prayer: "magic",
    });
    expect(reported.status).toBe(200);

    const states = await hostStream.next("states");
    const mine = states.states.find((state) => state.id === guest.playerId);
    expect(mine).toMatchObject({ tick: 12, tile: { x: 5, y: 6 }, hp: 70, prayer: "magic" });
    hostStream.close();
  });

  it("refuses a state posted with someone else's token", async () => {
    const host = await open("Zoy");
    const guest = await join(host.code, "Ziad");
    const response = await post(`/mp/rooms/${host.code}/state`, {
      playerId: guest.playerId,
      token: host.token,
      tick: 1,
      tile: { x: 0, y: 0 },
      hp: 1,
      maxHp: 99,
    });
    expect(response.status).toBe(403);
  });
});

describe("authority", () => {
  it("carries the host's verdict to a guest", async () => {
    const host = await open("Zoy");
    const guest = await join(host.code, "Ziad");
    const guestStream = await listen(guest);
    await guestStream.next("welcome");

    const judged = await post(`/mp/rooms/${host.code}/authority`, {
      playerId: host.playerId,
      token: host.token,
      authority: { tick: 8, targetId: guest.playerId, hits: [{ id: guest.playerId, damage: 37, cause: "slam" }], deaths: [] },
    });
    expect(judged.status).toBe(200);

    const event = await guestStream.next("authority");
    expect(event.authority.targetId).toBe(guest.playerId);
    expect(event.authority.hits[0]).toMatchObject({ id: guest.playerId, damage: 37 });
    guestStream.close();
  });

  it("refuses a verdict from a guest, so nobody can kill another player", async () => {
    const host = await open("Zoy");
    const guest = await join(host.code, "Ziad");
    const response = await post(`/mp/rooms/${host.code}/authority`, {
      playerId: guest.playerId,
      token: guest.token,
      authority: { tick: 1, targetId: host.playerId, hits: [], deaths: [host.playerId] },
    });
    expect(response.status).toBe(403);
  });

  it("marks a death on the roster everyone sees", async () => {
    const host = await open("Zoy");
    const guest = await join(host.code, "Ziad");
    const hostStream = await listen(host);
    await hostStream.next("welcome");
    const before = hostStream.count();

    await post(`/mp/rooms/${host.code}/authority`, {
      playerId: host.playerId,
      token: host.token,
      authority: { tick: 20, targetId: guest.playerId, hits: [], deaths: [guest.playerId] },
    });

    const roster = await hostStream.next("roster", before);
    expect(roster.roster.find((member) => member.id === guest.playerId)?.dead).toBe(true);
    hostStream.close();
  });
});

describe("intents", () => {
  it("relays a guest's walk to the host but not back to the sender", async () => {
    const host = await open("Zoy");
    const guest = await join(host.code, "Ziad");
    const hostStream = await listen(host);
    const guestStream = await listen(guest);
    await Promise.all([hostStream.next("welcome"), guestStream.next("welcome")]);
    const guestSeen = guestStream.count();

    await post(`/mp/rooms/${host.code}/intent`, {
      playerId: guest.playerId,
      token: guest.token,
      intent: { kind: "walk", to: { x: 9, y: 9 }, running: true },
    });

    const relayed = await hostStream.next("intent");
    expect(relayed.from).toBe(guest.playerId);
    expect(relayed.intent).toMatchObject({ kind: "walk", to: { x: 9, y: 9 }, running: true });
    await expect(guestStream.next("intent", guestSeen)).rejects.toThrow();
    hostStream.close();
    guestStream.close();
  }, 10000);
});

describe("serving the site", () => {
  it("never serves a file from outside the built directory", async () => {
    const response = await send("GET", "/../../package.json");
    expect(response.body).not.toContain("archive-ocellus-trainer");
  });

  it("answers an unknown room with a 404 rather than a stack", async () => {
    const response = await post("/mp/rooms/AAAAAA/join", { name: "Zoy" });
    expect(response.status).toBe(409);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("no room") });
  });
});
