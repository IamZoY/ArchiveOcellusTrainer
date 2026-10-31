/**
 * The browser's end of a room: one event stream in, small posts out.
 *
 * It holds no opinion about the fight. The page asks it to open or join a room, reads the roster off it, and pushes
 * this player's state at it each tick; what arrives from the stream is handed on as plain data for the page to apply.
 */
import type { Authority, Intent, PlayerId, PlayerState, RoomCode, Roster, ServerEvent, Style } from "./protocol";

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
  | Readonly<{ kind: "lobby"; connection: Connection; roster: Roster }>
  | Readonly<{ kind: "fighting"; connection: Connection; roster: Roster; startedAt: number }>
  | Readonly<{ kind: "failed"; error: string }>;

export type Handlers = Readonly<{
  states(states: readonly PlayerState[]): void;
  authority(authority: Authority): void;
  intent(from: PlayerId, intent: Intent): void;
  ended(reason: string): void;
}>;

export type Report = Readonly<{ tick: number; tile: Readonly<{ x: number; y: number }>; hp: number; maxHp: number; prayer: Style | null; dead: boolean }>;

const NO_HANDLERS: Handlers = { states: () => {}, authority: () => {}, intent: () => {}, ended: () => {} };

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

export class RoomClient {
  private stream: EventSource | null = null;
  private connection: Connection | null = null;
  private current: Phase = { kind: "offline" };
  private roster: Roster = [];
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

  on(handlers: Partial<Handlers>): void {
    this.handlers = { ...NO_HANDLERS, ...handlers };
  }

  private set(phase: Phase): void {
    this.current = phase;
    for (const watcher of this.watchers) watcher();
  }

  private url(path: string): string {
    return `${this.base}/mp${path}`;
  }

  async open(name: string, seed: number, startPhase: number): Promise<void> {
    this.set({ kind: "connecting" });
    try {
      this.begin(connectionFrom(await ask(this.url("/rooms"), { name, seed, startPhase }), true));
    } catch (error) {
      this.fail(error);
    }
  }

  async join(code: RoomCode, name: string): Promise<void> {
    this.set({ kind: "connecting" });
    try {
      this.begin(connectionFrom(await ask(this.url(`/rooms/${code}/join`), { name }), false));
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    this.set({ kind: "failed", error: error instanceof Error ? error.message : "could not reach the room server" });
  }

  private begin(connection: Connection): void {
    this.connection = connection;
    this.roster = [];
    this.set({ kind: "lobby", connection, roster: [] });
    const stream = new EventSource(this.url(`/rooms/${connection.code}/events?playerId=${connection.you}&token=${connection.token}`));
    this.stream = stream;
    stream.onmessage = (message) => this.take(message.data);
    for (const kind of ["welcome", "roster", "start", "states", "authority", "intent", "ended", "ping"]) {
      stream.addEventListener(kind, (event) => this.take(Reflect.get(event, "data")));
    }
    stream.onerror = () => {
      if (this.current.kind === "connecting") this.fail(new Error("the room server closed the stream"));
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
      case "welcome":
        this.roster = event.roster;
        this.set({ kind: "lobby", connection, roster: event.roster });
        return;
      case "roster": {
        this.roster = event.roster;
        this.set(this.current.kind === "fighting" ? { ...this.current, roster: event.roster } : { kind: "lobby", connection, roster: event.roster });
        return;
      }
      case "start":
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
      case "ended":
        this.handlers.ended(event.reason);
        this.set({ kind: "lobby", connection, roster: this.roster });
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

  start(): void {
    this.post("/start", {});
  }

  /** Reporting the same thing twice in a row says nothing, so it is not sent. */
  report(report: Report): void {
    const key = `${report.tick}:${report.tile.x},${report.tile.y}:${report.hp}:${report.prayer ?? "-"}:${report.dead}`;
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

  leave(): void {
    this.post("/leave", {});
    this.stream?.close();
    this.stream = null;
    this.connection = null;
    this.roster = [];
    this.set({ kind: "offline" });
  }

  /** True when this client is the one whose fight everyone else is watching. */
  isHost(): boolean {
    return this.connection?.host === true;
  }
}
