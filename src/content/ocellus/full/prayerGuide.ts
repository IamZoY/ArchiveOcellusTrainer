import type { Tick } from "../../../sim/brands";
import type { Style } from "../../../sim/combat";
import type { CueChange, PrayerCue } from "../../../sim/prayerCue";
import { PROTECTION_PRAYER } from "../../../sim/prayerCue";
import type { TileMark } from "../fight/effects";
import type { ATile, Body } from "../fight/geometry";
import { at } from "../fight/geometry";

/** Magic blue, ranged green, melee red: the colour of the card's style and of the highlight under the tell. */
export const STYLE_COLOUR: Readonly<Record<Style, number>> = { magic: 0x3b8bff, ranged: 0x2fd05a, melee: 0xff3b30 };
export const PRAYER_NAME = PROTECTION_PRAYER;

/** One attack on the card: what to pray, how many ticks until it lands, and why. */
export type CardLine = Readonly<{ cue: PrayerCue; inTicks: number }>;
export type GuideCard = Readonly<{ kind: "coming"; now: CardLine; next: CardLine | null }> | Readonly<{ kind: "idle"; note: string }>;

/** What the highlight is drawn around, read as the frame draws: where he and the player stand now. */
export type Whereabouts = Readonly<{ boss(): Body | null; player(): ATile | null }>;

const HIGHLIGHT = { ring: 0.55, landing: 0.7, inset: 0.05 } as const;

/**
 * The prayer guide's state for the running phase: every cue told and not yet landed, on the phase's own clock. Phases feed
 * it each closed row's cue changes; it does nothing else per tick.
 */
export class PrayerGuide {
  private now = 0;
  private pending: readonly PrayerCue[] = [];

  /** A new phase or a restart: its clock starts again and nothing told before carries over. */
  reset(): void {
    this.now = 0;
    this.pending = [];
  }

  present(now: Tick, changes: readonly CueChange[]): void {
    this.now = now;
    let pending = this.pending;
    for (const change of changes) {
      switch (change.kind) {
        case "told":
          pending = [...pending, change.cue];
          break;
        case "dropped":
          pending = pending.filter((cue) => cue.id !== change.id);
          break;
        default: {
          const unhandled: never = change;
          return unhandled;
        }
      }
    }
    this.pending = pending.filter((cue) => cue.lands > now).sort((a, b) => a.lands - b.lands || a.id - b.id);
  }

  /** The attacks still to land, soonest first. */
  coming(): readonly PrayerCue[] {
    return this.pending;
  }

  card(idle: string): GuideCard {
    const [first, second] = this.pending;
    if (first === undefined) return { kind: "idle", note: idle };
    const line = (cue: PrayerCue): CardLine => ({ cue, inTicks: cue.lands - this.now });
    return { kind: "coming", now: line(first), next: second === undefined ? null : line(second) };
  }

  /** The soonest attack's tell, lit in its style's colour: a ring round his body, or the tile its projectile flies to. */
  marks(where: Whereabouts): readonly TileMark[] {
    const cue = this.pending[0];
    if (cue === undefined) return [];
    const colour = STYLE_COLOUR[cue.style];
    switch (cue.on.kind) {
      case "boss": {
        const body = where.boss();
        return body === null ? [] : ringAround(body).map((tile) => ({ tile, colour, opacity: HIGHLIGHT.ring, inset: HIGHLIGHT.inset }));
      }
      case "target": {
        const tile = where.player();
        return tile === null ? [] : [{ tile, colour, opacity: HIGHLIGHT.landing, inset: HIGHLIGHT.inset }];
      }
      default: {
        const unhandled: never = cue.on;
        return unhandled;
      }
    }
  }
}

/** The tiles one step outside a body, which his model does not hide. */
function ringAround(body: Body): readonly ATile[] {
  const tiles: ATile[] = [];
  const { sw, size } = body;
  for (let x = sw.x - 1; x <= sw.x + size; x++) {
    for (let z = sw.z - 1; z <= sw.z + size; z++) {
      const inside = x >= sw.x && x < sw.x + size && z >= sw.z && z < sw.z + size;
      if (!inside) tiles.push(at(x, z));
    }
  }
  return tiles;
}
