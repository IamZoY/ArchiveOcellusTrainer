/**
 * Every rule a room has, with no HTTP and no clock of its own: the server passes the time in and sends what comes
 * back. That keeps the rules testable without a socket, and keeps the transport free of decisions.
 */
import type { Authority, Gear, Intent, Member, PlayerId, PlayerState, RoomCode, Roster, ServerEvent } from "./protocol";
import { CODE_ALPHABET, CODE_LENGTH, MAX_PLAYERS, STALE_MS } from "./protocol";

export type Rejection =
  | Readonly<{ kind: "no-room" }>
  | Readonly<{ kind: "full" }>
  | Readonly<{ kind: "already-started" }>
  | Readonly<{ kind: "not-a-member" }>
  | Readonly<{ kind: "not-the-host" }>
  | Readonly<{ kind: "bad-token" }>
  | Readonly<{ kind: "not-ready" }>;

export type Outcome<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; why: Rejection }>;

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const no = <T>(why: Rejection): Outcome<T> => ({ ok: false, why });

export function why(rejection: Rejection): string {
  switch (rejection.kind) {
    case "no-room":
      return "no room with that code";
    case "full":
      return "that room is full";
    case "already-started":
      return "that fight has already started";
    case "not-a-member":
      return "you are not in that room";
    case "not-the-host":
      return "only the host can do that";
    case "bad-token":
      return "that token does not match";
    case "not-ready":
      return "everyone must be ready first";
    default: {
      const unhandled: never = rejection;
      return unhandled;
    }
  }
}

type Seat = {
  readonly id: PlayerId;
  readonly token: string;
  readonly name: string;
  gear: Gear | null;
  ready: boolean;
  dead: boolean;
  seenAt: number;
  state: PlayerState | null;
};

export type Room = {
  readonly code: RoomCode;
  readonly seed: number;
  readonly startPhase: number;
  hostId: PlayerId;
  started: boolean;
  startedAt: number | null;
  readonly seats: Map<PlayerId, Seat>;
};

export type Random = Readonly<{ letters(count: number): string; id(): string }>;

/** The id a seat is given is also its secret, so the two are drawn apart and the token never travels in a roster. */
export function randomFrom(bytes: (n: number) => Uint8Array): Random {
  return {
    letters: (count) => [...bytes(count)].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length] ?? "A").join(""),
    id: () => [...bytes(16)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

export class Rooms {
  private readonly rooms = new Map<RoomCode, Room>();

  constructor(private readonly random: Random) {}

  /** A code is drawn until it is free, so two rooms can never share one. */
  private freeCode(): RoomCode {
    for (let attempt = 0; attempt < 64; attempt++) {
      const code = this.random.letters(CODE_LENGTH);
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("could not find a free room code");
  }

  open(hostName: string, seed: number, startPhase: number, now: number, gear: Gear | null = null): Readonly<{ room: Room; seat: Seat }> {
    const code = this.freeCode();
    const seat = this.seat(hostName, now, gear);
    const room: Room = { code, seed, startPhase, hostId: seat.id, started: false, startedAt: null, seats: new Map([[seat.id, seat]]) };
    this.rooms.set(code, room);
    return { room, seat };
  }

  private seat(name: string, now: number, gear: Gear | null): Seat {
    return { id: this.random.id(), token: this.random.id(), name, gear, ready: false, dead: false, seenAt: now, state: null };
  }

  get(code: RoomCode): Room | null {
    return this.rooms.get(code) ?? null;
  }

  join(code: RoomCode, name: string, now: number, gear: Gear | null = null): Outcome<Readonly<{ room: Room; seat: Seat }>> {
    const room = this.rooms.get(code);
    if (!room) return no({ kind: "no-room" });
    if (room.started) return no({ kind: "already-started" });
    if (room.seats.size >= MAX_PLAYERS) return no({ kind: "full" });
    const seat = this.seat(name, now, gear);
    room.seats.set(seat.id, seat);
    return ok({ room, seat });
  }

  /** Every write names its seat and proves it, so one player cannot move or ready another. */
  private authorise(code: RoomCode, id: PlayerId, token: string): Outcome<Readonly<{ room: Room; seat: Seat }>> {
    const room = this.rooms.get(code);
    if (!room) return no({ kind: "no-room" });
    const seat = room.seats.get(id);
    if (!seat) return no({ kind: "not-a-member" });
    if (seat.token !== token) return no({ kind: "bad-token" });
    return ok({ room, seat });
  }

  setReady(code: RoomCode, id: PlayerId, token: string, ready: boolean, now: number): Outcome<Room> {
    const found = this.authorise(code, id, token);
    if (!found.ok) return found;
    found.value.seat.ready = ready;
    found.value.seat.seenAt = now;
    return ok(found.value.room);
  }

  /** Gear is chosen in the lobby, and a change reaches everyone through the roster. */
  setGear(code: RoomCode, id: PlayerId, token: string, gear: Gear | null, now: number): Outcome<Room> {
    const found = this.authorise(code, id, token);
    if (!found.ok) return found;
    found.value.seat.gear = gear;
    found.value.seat.seenAt = now;
    return ok(found.value.room);
  }

  /** The host starts the fight, and only once everyone has said they are ready. */
  start(code: RoomCode, id: PlayerId, token: string, now: number): Outcome<Room> {
    const found = this.authorise(code, id, token);
    if (!found.ok) return found;
    const { room, seat } = found.value;
    if (room.hostId !== seat.id) return no({ kind: "not-the-host" });
    if (room.started) return no({ kind: "already-started" });
    if (![...room.seats.values()].every((member) => member.ready)) return no({ kind: "not-ready" });
    room.started = true;
    room.startedAt = now;
    return ok(room);
  }

  report(code: RoomCode, id: PlayerId, token: string, state: PlayerState, now: number): Outcome<Room> {
    const found = this.authorise(code, id, token);
    if (!found.ok) return found;
    found.value.seat.state = state;
    found.value.seat.seenAt = now;
    if (state.dead) found.value.seat.dead = true;
    return ok(found.value.room);
  }

  /** Only the host may say what a hit did, so a guest cannot heal itself or kill another. */
  judge(code: RoomCode, id: PlayerId, token: string, authority: Authority, now: number): Outcome<Room> {
    const found = this.authorise(code, id, token);
    if (!found.ok) return found;
    const { room, seat } = found.value;
    if (room.hostId !== seat.id) return no({ kind: "not-the-host" });
    seat.seenAt = now;
    for (const dead of authority.deaths) {
      const died = room.seats.get(dead);
      if (died) died.dead = true;
    }
    return ok(room);
  }

  relay(code: RoomCode, id: PlayerId, token: string, intent: Intent, now: number): Outcome<Readonly<{ room: Room; event: ServerEvent }>> {
    const found = this.authorise(code, id, token);
    if (!found.ok) return found;
    found.value.seat.seenAt = now;
    return ok({ room: found.value.room, event: { kind: "intent", from: id, intent } });
  }

  leave(code: RoomCode, id: PlayerId, token: string): Outcome<Room> {
    const found = this.authorise(code, id, token);
    if (!found.ok) return found;
    const { room } = found.value;
    room.seats.delete(id);
    this.settle(room);
    return ok(room);
  }

  /** A room with nobody in it is forgotten, and one whose host left hands the seat to whoever waited longest. */
  private settle(room: Room): void {
    if (room.seats.size === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.seats.has(room.hostId)) return;
    const next = [...room.seats.keys()][0];
    if (next !== undefined) room.hostId = next;
  }

  /** Anyone who has not reported inside the stale window is dropped, so a closed tab does not hold up a lobby. */
  sweep(now: number, staleMs: number = STALE_MS): readonly Room[] {
    const touched: Room[] = [];
    for (const room of this.rooms.values()) {
      let dropped = false;
      for (const seat of [...room.seats.values()]) {
        if (now - seat.seenAt <= staleMs) continue;
        room.seats.delete(seat.id);
        dropped = true;
      }
      if (!dropped) continue;
      this.settle(room);
      touched.push(room);
    }
    return touched;
  }

  touch(code: RoomCode, id: PlayerId, now: number): void {
    const seat = this.rooms.get(code)?.seats.get(id);
    if (seat) seat.seenAt = now;
  }

  count(): number {
    return this.rooms.size;
  }
}

export function rosterOf(room: Room): Roster {
  return [...room.seats.values()].map((seat): Member => ({ id: seat.id, name: seat.name, ready: seat.ready, host: seat.id === room.hostId, dead: seat.dead, gear: seat.gear }));
}

/** Everyone's latest report, newest wins, with the reporter's own left out by the caller if it wants. */
export function statesOf(room: Room): readonly PlayerState[] {
  return [...room.seats.values()].flatMap((seat) => (seat.state === null ? [] : [seat.state]));
}
