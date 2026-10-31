import { describe, expect, it } from "vitest";
import { Rooms, randomFrom, rosterOf, statesOf, why } from "./rooms";
import type { PlayerState } from "./protocol";
import { CODE_LENGTH, MAX_PLAYERS, STALE_MS, isRoomCode, parseAuthority, parseIntent, parseName, parsePlayerState } from "./protocol";

/** A counter stands in for randomness so every code and id in a test is known in advance. */
function counting() {
  let next = 0;
  return randomFrom((n) => Uint8Array.from({ length: n }, () => next++));
}

const rooms = () => new Rooms(counting());

function stateAt(at: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return { id: "unused", tick: at, tile: { x: 1, y: 2 }, hp: 99, maxHp: 99, prayer: null, dead: false, ...overrides };
}

describe("room codes", () => {
  it("draws six readable letters and never repeats a live code", () => {
    const all = rooms();
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { room } = all.open("Zoy", 7, 1, 0);
      expect(room.code).toHaveLength(CODE_LENGTH);
      expect(isRoomCode(room.code)).toBe(true);
      expect(codes.has(room.code)).toBe(false);
      codes.add(room.code);
    }
  });

  it("leaves out the letters that sound or look alike", () => {
    const { room } = rooms().open("Zoy", 7, 1, 0);
    for (const confusable of ["I", "O", "S", "B", "Z"]) expect(room.code).not.toContain(confusable);
  });
});

describe("joining", () => {
  it("hands every joiner the host's seed, so the fight is the same one", () => {
    const all = rooms();
    const { room } = all.open("Zoy", 4242, 3, 0);
    const joined = all.join(room.code, "Ziad", 0);
    expect(joined.ok).toBe(true);
    expect(all.get(room.code)?.seed).toBe(4242);
    expect(all.get(room.code)?.startPhase).toBe(3);
  });

  it("refuses an unknown code, a full room and a fight already under way", () => {
    const all = rooms();
    expect(all.join("AAAAAA", "Ziad", 0)).toMatchObject({ ok: false, why: { kind: "no-room" } });

    const { room, seat } = all.open("Zoy", 7, 1, 0);
    for (let i = 1; i < MAX_PLAYERS; i++) expect(all.join(room.code, `P${i}`, 0).ok).toBe(true);
    expect(all.join(room.code, "late", 0)).toMatchObject({ ok: false, why: { kind: "full" } });

    for (const member of room.seats.values()) all.setReady(room.code, member.id, member.token, true, 0);
    expect(all.start(room.code, seat.id, seat.token, 0).ok).toBe(true);
    const after = all.join(room.code, "later", 0);
    expect(after).toMatchObject({ ok: false, why: { kind: "already-started" } });
  });
});

describe("starting", () => {
  it("waits for everyone to be ready, and only the host may start", () => {
    const all = rooms();
    const { room, seat: host } = all.open("Zoy", 7, 1, 0);
    const guest = all.join(room.code, "Ziad", 0);
    if (!guest.ok) throw new Error("join failed");

    expect(all.start(room.code, host.id, host.token, 0)).toMatchObject({ ok: false, why: { kind: "not-ready" } });

    all.setReady(room.code, host.id, host.token, true, 0);
    all.setReady(room.code, guest.value.seat.id, guest.value.seat.token, true, 0);

    expect(all.start(room.code, guest.value.seat.id, guest.value.seat.token, 0)).toMatchObject({ ok: false, why: { kind: "not-the-host" } });
    expect(all.start(room.code, host.id, host.token, 5)).toMatchObject({ ok: true });
    expect(all.get(room.code)?.started).toBe(true);
    expect(all.get(room.code)?.startedAt).toBe(5);
    expect(all.start(room.code, host.id, host.token, 6)).toMatchObject({ ok: false, why: { kind: "already-started" } });
  });

  it("un-readying before the start holds the fight", () => {
    const all = rooms();
    const { room, seat: host } = all.open("Zoy", 7, 1, 0);
    const guest = all.join(room.code, "Ziad", 0);
    if (!guest.ok) throw new Error("join failed");
    all.setReady(room.code, host.id, host.token, true, 0);
    all.setReady(room.code, guest.value.seat.id, guest.value.seat.token, true, 0);
    all.setReady(room.code, guest.value.seat.id, guest.value.seat.token, false, 0);
    expect(all.start(room.code, host.id, host.token, 0)).toMatchObject({ ok: false, why: { kind: "not-ready" } });
  });
});

describe("authority", () => {
  it("takes a death from the host and refuses one from a guest", () => {
    const all = rooms();
    const { room, seat: host } = all.open("Zoy", 7, 1, 0);
    const guest = all.join(room.code, "Ziad", 0);
    if (!guest.ok) throw new Error("join failed");
    const victim = guest.value.seat;

    const forged = all.judge(room.code, victim.id, victim.token, { tick: 3, targetId: null, hits: [], deaths: [host.id] }, 0);
    expect(forged).toMatchObject({ ok: false, why: { kind: "not-the-host" } });
    expect(room.seats.get(host.id)?.dead).toBe(false);

    const judged = all.judge(room.code, host.id, host.token, { tick: 3, targetId: victim.id, hits: [{ id: victim.id, damage: 40, cause: "slam" }], deaths: [victim.id] }, 0);
    expect(judged.ok).toBe(true);
    expect(room.seats.get(victim.id)?.dead).toBe(true);
    expect(rosterOf(room).find((member) => member.id === victim.id)?.dead).toBe(true);
  });

  it("refuses a seat whose token does not match", () => {
    const all = rooms();
    const { room, seat } = all.open("Zoy", 7, 1, 0);
    expect(all.setReady(room.code, seat.id, "wrong", true, 0)).toMatchObject({ ok: false, why: { kind: "bad-token" } });
    expect(all.report(room.code, "nobody", "x", stateAt(1), 0)).toMatchObject({ ok: false, why: { kind: "not-a-member" } });
  });
});

describe("reports", () => {
  it("keeps each seat's latest state and marks a self-reported death", () => {
    const all = rooms();
    const { room, seat } = all.open("Zoy", 7, 1, 0);
    all.report(room.code, seat.id, seat.token, stateAt(1, { id: seat.id }), 0);
    all.report(room.code, seat.id, seat.token, stateAt(2, { id: seat.id, hp: 0, dead: true }), 0);
    const states = statesOf(room);
    expect(states).toHaveLength(1);
    expect(states[0]?.tick).toBe(2);
    expect(room.seats.get(seat.id)?.dead).toBe(true);
  });
});

describe("leaving and sweeping", () => {
  it("passes the host seat on and forgets an empty room", () => {
    const all = rooms();
    const { room, seat: host } = all.open("Zoy", 7, 1, 0);
    const guest = all.join(room.code, "Ziad", 0);
    if (!guest.ok) throw new Error("join failed");

    all.leave(room.code, host.id, host.token);
    expect(all.get(room.code)?.hostId).toBe(guest.value.seat.id);

    all.leave(room.code, guest.value.seat.id, guest.value.seat.token);
    expect(all.get(room.code)).toBeNull();
    expect(all.count()).toBe(0);
  });

  it("drops a seat that stopped reporting and keeps one that did not", () => {
    const all = rooms();
    const { room, seat: host } = all.open("Zoy", 7, 1, 0);
    const guest = all.join(room.code, "Ziad", 0);
    if (!guest.ok) throw new Error("join failed");

    all.touch(room.code, host.id, STALE_MS);
    all.sweep(STALE_MS + 1);

    expect(room.seats.has(host.id)).toBe(true);
    expect(room.seats.has(guest.value.seat.id)).toBe(false);
  });
});

describe("parsing what arrives from another machine", () => {
  it("keeps a good state and refuses a broken one", () => {
    expect(parsePlayerState({ tick: 4, tile: { x: 1, y: 2 }, hp: 50, maxHp: 99 }, "me")).toMatchObject({ tick: 4, hp: 50, dead: false });
    expect(parsePlayerState({ tick: -1, tile: { x: 1, y: 2 }, hp: 1, maxHp: 1 }, "me")).toBeNull();
    expect(parsePlayerState({ tick: 1, tile: { x: 1.5, y: 2 }, hp: 1, maxHp: 1 }, "me")).toBeNull();
    expect(parsePlayerState({ tick: 1, tile: { x: 1, y: 2 }, hp: 1, maxHp: 0 }, "me")).toBeNull();
  });

  it("caps reported hp at the reported maximum, so nobody claims more than they have", () => {
    expect(parsePlayerState({ tick: 1, tile: { x: 0, y: 0 }, hp: 9999, maxHp: 99 }, "me")?.hp).toBe(99);
  });

  it("keeps only the prayers the fight knows", () => {
    expect(parsePlayerState({ tick: 1, tile: { x: 0, y: 0 }, hp: 1, maxHp: 1, prayer: "magic" }, "me")?.prayer).toBe("magic");
    expect(parsePlayerState({ tick: 1, tile: { x: 0, y: 0 }, hp: 1, maxHp: 1, prayer: "rigour" }, "me")?.prayer).toBeNull();
  });

  it("reads the intents a guest can send and refuses anything else", () => {
    expect(parseIntent({ kind: "walk", to: { x: 3, y: 4 }, running: true })).toMatchObject({ kind: "walk", running: true });
    expect(parseIntent({ kind: "prayer", prayer: "melee" })).toMatchObject({ kind: "prayer", prayer: "melee" });
    expect(parseIntent({ kind: "teleport", to: { x: 0, y: 0 } })).toBeNull();
  });

  it("drops the malformed entries from an authority rather than the whole verdict", () => {
    const authority = parseAuthority({ tick: 2, targetId: "a", hits: [{ id: "a", damage: 10, cause: "swing" }, { id: "b" }, { damage: 3 }], deaths: ["b"] });
    expect(authority?.hits).toHaveLength(1);
    expect(authority?.deaths).toEqual(["b"]);
  });

  it("cleans a name and refuses one that is empty once cleaned", () => {
    expect(parseName("  Zoy  ")).toBe("Zoy");
    expect(parseName("<b>Zoy</b>")).toBe("bZoyb");
    expect(parseName("!!!")).toBeNull();
    expect(parseName("")).toBeNull();
    expect(parseName("a".repeat(50))?.length).toBe(12);
  });
});

describe("rejection wording", () => {
  it("says something for every rejection", () => {
    for (const kind of ["no-room", "full", "already-started", "not-a-member", "not-the-host", "bad-token", "not-ready"] as const) {
      expect(why({ kind })).toMatch(/\w/);
    }
  });
});
