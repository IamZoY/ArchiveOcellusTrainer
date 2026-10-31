/**
 * The browser's end of a room: one event stream in, small posts out.
 *
 * It holds no opinion about the fight. The page asks it to open or join a room, reads the roster off it, and pushes
 * this player's state at it each tick; what arrives from the stream is handed on as plain data for the page to apply.
 */
import type { Authority, Gear, Intent, PlayerId, PlayerState, RoomCode, Roster, ServerEvent, Style, Swing, Worn } from "./protocol";
import { EVENT_KINDS } from "./protocol";

export type Connection = Readonly<{
  code: RoomCode;
  you: PlayerId;
  token: string;
  seed: number;
  startPhase: number;
  host: boolean;
}>;

export type Phase =
  | Readonly<{ kind: "offline" }>
  | Readonly<{ kind: "connecting" }>
  /** `running` means the room's fight is already under way and this client is waiting out the rest of it. */
  | Readonly<{ kind: "lobby"; connection: Connection; roster: Roster; running: boolean }>
  | Readonly<{ kind: "fighting"; connection: Connection; roster: Roster; startedAt: number }>
  | Readonly<{ kind: "failed"; error: string }>;

export type Handlers = Readonly<{
  states(states: readonly PlayerState[]): void;
  authority(authority: Authority): void;
  intent(from: PlayerId, intent: Intent): void;
  ended(reason: string): void;
  /** The host has put the room back in its lobby to run the fight again. */
  regroup(run: number): void;
}>;

export type Report = Readonly<{ tick: number; tile: Readonly<{ x: number; y: number }>; hp: number; maxHp: number; prayer: Style | null; dead: boolean; worn: Worn | null; swing: Swing }>;

const NO_HANDLERS: Handlers = { states: () => {}, authority: () => {}, intent: () => {}, ended: () => {}, regroup: () => {} };

async function ask(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload ? String(Reflect.get(payload, "error")) : `request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function connectionFrom(raw: unknown, host: boolean): Connection {
  const get = (key: string): unknown => (typeof raw === "object" && raw !== null ? Reflect.get(raw, key) : undefined);
  const code = String(get("code"));
  const you = String(get("playerId"));
  const token = String(get("token"));
  const seed = Number(get("seed"));
  const startPhase = Number(get("startPhase"));
  if (!code || !you || !token || !Number.isFinite(seed)) throw new Error("the room server answered with something unusable");
  return { code, you, token, seed, startPhase, host: get("host") === true || host };
}

const SEAT_KEY = "archive-ocellus-coop-seat";

/** The seat this tab holds, kept across a reload so the same person comes back rather than a new one. */
function rememberSeat(connection: Connection): void {
  try {
    sessionStorage.setItem(SEAT_KEY, JSON.stringify({ code: connection.code, you: connection.you, token: connection.token }));
  } catch {
    // a private window refuses storage; a reload then rejoins as a new seat
  }
}

export function savedSeat(code: string): Readonly<{ you: string; token: string }> | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(SEAT_KEY) ?? "null");
    const held = typeof raw === "object" && raw !== null ? raw : null;
    if (held === null || Reflect.get(held, "code") !== code) return null;
    const you = String(Reflect.get(held, "you"));
    const token = String(Reflect.get(held, "token"));
    return you && token ? { you, token } : null;
  } catch {
    return null;
  }
}

function forgetSeat(): void {
  try {
    sessionStorage.removeItem(SEAT_KEY);
  } catch {
    // nothing held it in the first place
  }
}

export class RoomClient {
  private stream: EventSource | null = null;
  private connection: Connection | null = null;
  private current: Phase = { kind: "offline" };
  private roster: Roster = [];
  /** The room is mid-fight without this client in it, which is how a lobby tells waiting from gathering. */
  private running = false;
  private handlers: Handlers = NO_HANDLERS;
  private readonly watchers = new Set<() => void>();
  /** The last report that actually went out, so an unchanged tick costs no request. */
  private sent = "";

  constructor(private readonly base = "") {}

  subscribe(watcher: () => void): () => void {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  phase(): Phase {
    return this.current;
  }

  /** Merges, so the page and the running session can each listen for what they care about. */
  on(handlers: Partial<Handlers>): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  private set(phase: Phase): void {
    this.current = phase;
    for (const watcher of this.watchers) watcher();
  }

  private url(path: string): string {
    return `${this.base}/mp${path}`;
  }

  async open(name: string, seed: number, startPhase: number, gear: Gear | null = null): Promise<void> {
    this.set({ kind: "connecting" });
    try {
      this.begin(connectionFrom(await ask(this.url("/rooms"), { name, seed, startPhase, gear }), true));
    } catch (error) {
      this.fail(error);
    }
  }

  async join(code: RoomCode, name: string, gear: Gear | null = null): Promise<void> {
    this.set({ kind: "connecting" });
    try {
      this.begin(connectionFrom(await ask(this.url(`/rooms/${code}/join`), { name, gear }), false));
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    this.set({ kind: "failed", error: error instanceof Error ? error.message : "could not reach the room server" });
  }

  /** Comes back to a seat this tab already holds. The stream's welcome fills in what the seat does not carry. */
  resume(code: RoomCode, seat: Readonly<{ you: string; token: string }>, seed: number, startPhase: number): void {
    this.begin({ code, you: seat.you, token: seat.token, seed, startPhase, host: false });
  }

  private begin(connection: Connection): void {
    this.connection = connection;
    rememberSeat(connection);
    this.roster = [];
    // Still connecting until the stream says welcome: showing an empty lobby for a seat the room has forgotten is
    // worse than saying so, because it looks like everyone left.
    this.set({ kind: "connecting" });
    const stream = new EventSource(this.url(`/rooms/${connection.code}/events?playerId=${connection.you}&token=${connection.token}`));
    this.stream = stream;
    stream.onmessage = (message) => this.take(message.data);
    for (const kind of EVENT_KINDS) {
      stream.addEventListener(kind, (event) => this.take(Reflect.get(event, "data")));
    }
    stream.onerror = () => {
      if (this.current.kind !== "connecting") return;
      forgetSeat();
      this.fail(new Error("that room is no longer there; host or join a new one"));
    };
  }

  private take(raw: unknown): void {
    if (typeof raw !== "string") return;
    let event: ServerEvent;
    try {
      event = JSON.parse(raw) as ServerEvent;
    } catch {
      return;
    }
    const connection = this.connection;
    if (!connection) return;
    switch (event.kind) {
      case "welcome": {
        const mine = event.roster.find((member) => member.id === event.you);
        const settled: Connection = { ...connection, seed: event.seed, startPhase: event.startPhase, host: mine?.host === true };
        this.connection = settled;
        rememberSeat(settled);
        this.roster = event.roster;
        this.running = event.started;
        this.set({ kind: "lobby", connection: settled, roster: event.roster, running: event.started });
        return;
      }
      case "roster": {
        this.roster = event.roster;
        this.set(this.current.kind === "fighting" ? { ...this.current, roster: event.roster } : { kind: "lobby", connection, roster: event.roster, running: this.running });
        return;
      }
      case "setup": {
        // The room is on another fight now. The page reads this back and reloads onto it, since a fight is a pure
        // function of its seed from its first tick and cannot be changed under a running one.
        const moved: Connection = { ...connection, seed: event.seed, startPhase: event.startPhase };
        this.connection = moved;
        rememberSeat(moved);
        this.set(this.current.kind === "fighting" ? { ...this.current, connection: moved } : { kind: "lobby", connection: moved, roster: this.roster, running: this.running });
        return;
      }
      case "start":
        this.running = false;
        this.set({ kind: "fighting", connection, roster: this.roster, startedAt: event.at });
        return;
      case "states":
        this.handlers.states(event.states.filter((state) => state.id !== connection.you));
        return;
      case "authority":
        this.handlers.authority(event.authority);
        return;
      case "intent":
        this.handlers.intent(event.from, event.intent);
        return;
      case "regroup":
        this.running = false;
        this.handlers.regroup(event.run);
        this.set({ kind: "lobby", connection, roster: this.roster, running: false });
        return;
      case "ended":
        this.running = false;
        this.handlers.ended(event.reason);
        this.set({ kind: "lobby", connection, roster: this.roster, running: false });
        return;
      case "ping":
        return;
      default: {
        const unhandled: never = event;
        return unhandled;
      }
    }
  }

  private seat(): Readonly<{ playerId: string; token: string }> | null {
    return this.connection === null ? null : { playerId: this.connection.you, token: this.connection.token };
  }

  private post(path: string, body: Record<string, unknown>): void {
    const seat = this.seat();
    if (!seat || !this.connection) return;
    void ask(this.url(`/rooms/${this.connection.code}${path}`), { ...seat, ...body }).catch(() => {});
  }

  setReady(ready: boolean): void {
    this.post("/ready", { ready });
  }

  /** Changing tier or weapon in the lobby re-dresses this player for everyone else. */
  setGear(gear: Gear | null): void {
    this.post("/gear", { gear });
  }

  /** Host only: moves the room to the fight this page is on, so everyone else comes to it. */
  setup(seed: number, startPhase: number): void {
    this.post("/setup", { seed, startPhase });
  }

  start(): void {
    this.post("/start", {});
  }

  /** Reporting the same thing twice in a row says nothing, so it is not sent. */
  report(report: Report): void {
    const worn = report.worn === null ? "-" : Object.keys(report.worn).sort().map((slot) => `${slot}${report.worn?.[slot] ?? ""}`).join();
    const key = `${report.tick}:${report.tile.x},${report.tile.y}:${report.hp}:${report.prayer ?? "-"}:${report.dead}:${worn}`;
    if (key === this.sent) return;
    this.sent = key;
    this.post("/state", { ...report });
  }

  send(intent: Intent): void {
    this.post("/intent", { intent });
  }

  judge(authority: Authority): void {
    this.post("/authority", { authority });
  }

  /**
   * Host only: puts the room back in its lobby so the same team can run the fight again, on another seed or
   * starting phase if one is named, which is how the host's own fight controls move the whole room.
   */
  again(setup: Readonly<{ seed: number; startPhase: number }> | null = null): void {
    this.post("/again", setup === null ? {} : { seed: setup.seed, startPhase: setup.startPhase });
  }

  /** Waits for the seat to be given up, so a reload can rejoin under the same name without racing itself. */
  async leaveAndWait(): Promise<void> {
    const seat = this.seat();
    const connection = this.connection;
    if (seat && connection) await ask(this.url(`/rooms/${connection.code}/leave`), seat).catch(() => {});
    this.leave();
  }

  leave(): void {
    this.post("/leave", {});
    forgetSeat();
    this.stream?.close();
    this.stream = null;
    this.connection = null;
    this.roster = [];
    this.running = false;
    this.set({ kind: "offline" });
  }

  /** True when this client is the one whose fight everyone else is watching. */
  isHost(): boolean {
    return this.connection?.host === true;
  }
}
