/**
 * The wire between the room server and every client.
 *
 * Values cross the wire as plain JSON, never as the sim's branded numbers: a brand says a value was checked on this
 * side of the wire, and nothing arriving from another machine has been. Each client brands what it parses.
 */

/** Six letters a person reads aloud over voice chat, so the alphabet drops the pairs that sound or look alike. */
export const CODE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY";
export const CODE_LENGTH = 6;

export const MAX_PLAYERS = 8;
export const NAME_MAX = 12;
/** A body has eleven worn slots; the cap is what keeps a made-up one from growing the frame. */
export const WORN_SLOTS = 16;

/**
 * A seat with no stream is held this long before the room gives it up. It has to outlast a page reload, which for
 * this app means loading the cache assets again, so it is generous: a friend who reloads or whose connection blips
 * comes back to their own seat rather than to a room that has forgotten them.
 */
export const STALE_MS = 45_000;
/** The server tells every stream to keep itself open this often, which also evicts dead connections. */
export const HEARTBEAT_MS = 5_000;
/**
 * A seat this quiet is taken to be gone, and the same name may have it back. It is a few heartbeats, so a seat with
 * anyone actually behind it is never handed over, and a page that reloaded, crashed or was closed is not held to a
 * name its owner cannot use again.
 */
export const RECLAIM_AFTER_MS = 12_000;

export type PlayerId = string;
export type RoomCode = string;

export type Style = "melee" | "ranged" | "magic";

export type WireTile = Readonly<{ x: number; y: number }>;

/**
 * What a player has on, by item id, slot by slot. A swap mid-fight is a change of ids, so sending these is what lets
 * everyone else watch the switch happen rather than see the kit someone started in. An empty slot is left out.
 */
export type Worn = Readonly<Record<string, number>>;

/** What one player looks like to everyone else on a given fight tick. */
export type PlayerState = Readonly<{
  id: PlayerId;
  tick: number;
  tile: WireTile;
  hp: number;
  maxHp: number;
  prayer: Style | null;
  dead: boolean;
  worn: Worn | null;
}>;

/**
 * What someone is wearing, named rather than listed: a tier and the weapon in hand is enough for another client to
 * dress the same figure from its own catalog, and costs a few bytes once instead of an item list every tick.
 * `edited` says the tier was changed in the Loadout editor, so what others draw is the tier it started from.
 */
export type Gear = Readonly<{ tier: string; weapon: string | null; edited: boolean }>;

export type Member = Readonly<{
  id: PlayerId;
  name: string;
  ready: boolean;
  host: boolean;
  dead: boolean;
  gear: Gear | null;
}>;

export type Roster = readonly Member[];

/** The host's verdict for one tick: who the boss is on, and what each player took. */
export type Authority = Readonly<{
  tick: number;
  targetId: PlayerId | null;
  hits: readonly Readonly<{ id: PlayerId; damage: number; cause: string }>[];
  deaths: readonly PlayerId[];
}>;

/** A guest's intent, relayed to the host, which decides what it means. */
export type Intent =
  | Readonly<{ kind: "walk"; to: WireTile; running: boolean }>
  | Readonly<{ kind: "prayer"; prayer: Style | null }>;

export type ServerEvent =
  | Readonly<{ kind: "welcome"; you: PlayerId; code: RoomCode; seed: number; startPhase: number; roster: Roster; started: boolean }>
  | Readonly<{ kind: "roster"; roster: Roster }>
  | Readonly<{ kind: "start"; seed: number; startPhase: number; at: number; run: number }>
  /** The host has changed which fight the room is about to run: its seed, the phase it starts at, or both. */
  | Readonly<{ kind: "setup"; seed: number; startPhase: number }>
  | Readonly<{ kind: "regroup"; run: number }>
  | Readonly<{ kind: "states"; states: readonly PlayerState[] }>
  | Readonly<{ kind: "authority"; authority: Authority }>
  | Readonly<{ kind: "intent"; from: PlayerId; intent: Intent }>
  | Readonly<{ kind: "ended"; reason: "host-left" | "wiped" | "finished" }>
  | Readonly<{ kind: "ping" }>;

export type EventKind = ServerEvent["kind"];

/**
 * Every kind, named once. A stream carries the kind as the event name, so a listener has to be added per kind, and a
 * kind missing from this list would simply never arrive. Keying the record by the union makes leaving one out a
 * compile error rather than a silence.
 */
const EVERY_KIND: Readonly<Record<EventKind, true>> = {
  welcome: true,
  roster: true,
  start: true,
  setup: true,
  regroup: true,
  states: true,
  authority: true,
  intent: true,
  ended: true,
  ping: true,
};

export const EVENT_KINDS: readonly EventKind[] = Object.keys(EVERY_KIND).filter((kind): kind is EventKind => kind in EVERY_KIND);

const STYLES: readonly Style[] = ["melee", "ranged", "magic"];

const isRecord = (raw: unknown): raw is Readonly<Record<string, unknown>> => typeof raw === "object" && raw !== null && !Array.isArray(raw);

function field(raw: unknown, key: string): unknown {
  return isRecord(raw) ? raw[key] : undefined;
}

function finite(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function count(raw: unknown): number | null {
  const value = finite(raw);
  return value !== null && Number.isInteger(value) && value >= 0 ? value : null;
}

function text(raw: unknown, max: number): string | null {
  return typeof raw === "string" && raw.length > 0 && raw.length <= max ? raw : null;
}

export function parseStyle(raw: unknown): Style | null {
  return STYLES.find((style) => style === raw) ?? null;
}

export function parseTile(raw: unknown): WireTile | null {
  const x = finite(field(raw, "x"));
  const y = finite(field(raw, "y"));
  if (x === null || y === null || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { x, y };
}

/** Slots this build does not know are dropped rather than refused, so an older friend still shows up dressed. */
export function parseWorn(raw: unknown): Worn | null {
  if (!isRecord(raw)) return null;
  const worn: Record<string, number> = {};
  for (const [slot, value] of Object.entries(raw).slice(0, WORN_SLOTS)) {
    const id = count(value);
    if (id !== null && /^[a-z]{1,16}$/iu.test(slot)) worn[slot] = id;
  }
  return Object.keys(worn).length === 0 ? null : worn;
}

export function parsePlayerState(raw: unknown, id: PlayerId): PlayerState | null {
  const at = count(field(raw, "tick"));
  const tile = parseTile(field(raw, "tile"));
  const hp = count(field(raw, "hp"));
  const maxHp = count(field(raw, "maxHp"));
  if (at === null || tile === null || hp === null || maxHp === null || maxHp === 0) return null;
  const prayer = parseStyle(field(raw, "prayer"));
  return { id, tick: at, tile, hp: Math.min(hp, maxHp), maxHp, prayer, dead: field(raw, "dead") === true, worn: parseWorn(field(raw, "worn")) };
}

export function parseIntent(raw: unknown): Intent | null {
  const kind = field(raw, "kind");
  if (kind === "walk") {
    const to = parseTile(field(raw, "to"));
    return to === null ? null : { kind: "walk", to, running: field(raw, "running") === true };
  }
  if (kind === "prayer") return { kind: "prayer", prayer: parseStyle(field(raw, "prayer")) };
  return null;
}

export function parseAuthority(raw: unknown): Authority | null {
  const at = count(field(raw, "tick"));
  if (at === null) return null;
  const rawHits = field(raw, "hits");
  const rawDeaths = field(raw, "deaths");
  const hits: Readonly<{ id: PlayerId; damage: number; cause: string }>[] = [];
  if (Array.isArray(rawHits)) {
    for (const hit of rawHits) {
      const id = text(field(hit, "id"), 64);
      const damage = count(field(hit, "damage"));
      if (id !== null && damage !== null) hits.push({ id, damage, cause: text(field(hit, "cause"), 32) ?? "unknown" });
    }
  }
  const deaths = Array.isArray(rawDeaths) ? rawDeaths.flatMap((id) => (text(id, 64) === null ? [] : [String(id)])) : [];
  const targetId = text(field(raw, "targetId"), 64);
  return { tick: at, targetId, hits, deaths };
}

/** A long name is cut to fit rather than refused, since a person who typed one still meant to join. */
/** Only the names this build knows are kept; anything else dresses as the raid tier rather than failing a join. */
export function parseGear(raw: unknown, tiers: readonly string[], weapons: readonly string[]): Gear | null {
  const tier = tiers.find((known) => known === field(raw, "tier"));
  if (tier === undefined) return null;
  const asked = field(raw, "weapon");
  return { tier, weapon: weapons.find((known) => known === asked) ?? null, edited: field(raw, "edited") === true };
}

export function parseName(raw: unknown): string | null {
  const name = text(raw, 256);
  if (name === null) return null;
  const cleaned = name.trim().replace(/[^\w \-]/gu, "").replace(/\s+/gu, " ");
  return cleaned.length === 0 ? null : cleaned.slice(0, NAME_MAX);
}

export const START_PHASES: readonly number[] = [1, 2, 3, 4];

/** A seed and a phase a fight could actually be run from, which is all the room knows of either. */
export function parseSetup(rawSeed: unknown, rawPhase: unknown): Readonly<{ seed: number; startPhase: number }> | null {
  const seed = count(rawSeed);
  const startPhase = count(rawPhase);
  if (seed === null || seed > 0xffffffff || startPhase === null || !START_PHASES.includes(startPhase)) return null;
  return { seed, startPhase };
}

export function isRoomCode(raw: unknown): raw is RoomCode {
  return typeof raw === "string" && raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
}

/** An SSE frame. The kind rides as the event name so a client can listen per kind, and the body is one JSON line. */
export function encodeEvent(event: ServerEvent): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}
