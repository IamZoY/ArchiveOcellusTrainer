import type { Tick } from "../../../sim/brands";
import type { PrayerCue } from "../../../sim/prayerCue";
import { PROTECTION_PRAYER } from "../../../sim/prayerCue";
import type { Spot, Threat, ThreatChange, Tone, Where } from "../../../sim/threat";
import type { TileMark } from "../fight/effects";
import type { ATile, Body } from "../fight/geometry";
import { bodyCentre, bodyCentreTile, lineBetween } from "../fight/geometry";

/** Orange harm, magenta heal, white beat: none of them the Prayer guide's blue, green or red. */
export const TONE_COLOUR: Readonly<Record<Tone, number>> = { harm: 0xff9f1a, heal: 0xe040fb, beat: 0xf2f2f2 };

/** One line of the card: what comes, in how many ticks, and what to do. */
export type MechanicLine = Readonly<{ id: string; what: string; todo: string; tone: Tone; inTicks: number; count: number }>;
/** A countdown drawn in the scene, at a point on the arena's tile grid (a tile's centre is its whole coordinates). */
export type MechanicLabel = Readonly<{ x: number; z: number; text: string; colour: number }>;
/** Where he and the player stand now, read as the frame draws. */
export type Whereabouts = Readonly<{ boss(): Body | null; player(): ATile | null }>;

/** A threat with the clock it counts against: each phase source keeps its own. */
export type Timed = Readonly<{ threat: Threat<ATile>; now: number }>;

const MARK = { tiles: 0.45, wide: 0.22, wideFrom: 20, spot: 0.5, line: 0.5, inset: 0.1 } as const;

/** The warnings a phase's script tells and drops, kept until each lands. */
export class ThreatStore {
  private clock = 0;
  private pending: readonly Threat<ATile>[] = [];

  get now(): number {
    return this.clock;
  }

  reset(): void {
    this.clock = 0;
    this.pending = [];
  }

  present(now: Tick, changes: readonly ThreatChange<ATile>[]): void {
    this.clock = now;
    let pending = this.pending;
    for (const change of changes) {
      switch (change.kind) {
        case "told":
          pending = [...pending, change.threat];
          break;
        case "dropped":
          pending = pending.filter((threat) => threat.id !== change.id);
          break;
        default: {
          const unhandled: never = change;
          return unhandled;
        }
      }
    }
    this.pending = pending.filter((threat) => threat.lands > now);
  }

  coming(): readonly Threat<ATile>[] {
    return this.pending;
  }
}

/** A prayer cue as the mechanics guide shows it, so the two guides name the same attack the same way. */
export function prayerThreat(cue: PrayerCue): Threat<ATile> {
  const prayer = PROTECTION_PRAYER[cue.style];
  const where: Where<ATile> = cue.on.kind === "boss" ? { kind: "spot", at: { kind: "boss" } } : { kind: "flight", from: { kind: "boss" }, to: { kind: "player" }, block: false };
  return { what: `${cue.attack} (${cue.style})`, todo: cue.caution === null ? prayer : `${prayer}. ${cue.caution}`, tone: "harm", where, id: `prayer-${cue.id}`, told: cue.told, lands: cue.lands };
}

/** The card's lines, soonest first. The same mechanic landing on the same tick, such as a bomb's copies, is one line. */
export function mechanicLines(timed: readonly Timed[]): readonly MechanicLine[] {
  const lines = new Map<string, MechanicLine>();
  for (const { threat, now } of timed) {
    const inTicks = threat.lands - now;
    if (inTicks <= 0) continue;
    const key = `${inTicks}|${threat.what}|${threat.todo}`;
    const held = lines.get(key);
    lines.set(key, held ? { ...held, count: held.count + 1 } : { id: threat.id, what: threat.what, todo: threat.todo, tone: threat.tone, inTicks, count: 1 });
  }
  return [...lines.values()].sort((a, b) => a.inTicks - b.inTicks);
}

function spotTile(spot: Spot<ATile>, where: Whereabouts): ATile | null {
  switch (spot.kind) {
    case "tile":
      return spot.tile;
    case "player":
      return where.player();
    case "boss": {
      const body = where.boss();
      return body && bodyCentreTile(body);
    }
    default: {
      const unhandled: never = spot;
      return unhandled;
    }
  }
}

function spotPoint(spot: Spot<ATile>, where: Whereabouts): Readonly<{ x: number; z: number }> | null {
  if (spot.kind !== "boss") return spotTile(spot, where);
  const body = where.boss();
  return body && bodyCentre(body);
}

/** The floor each threat lands on, in its tone's colour: tiles to leave, the tile a shot flies to, and a heal's blocking line. */
export function mechanicMarks(timed: readonly Timed[], where: Whereabouts): readonly TileMark[] {
  const marks: TileMark[] = [];
  for (const { threat, now } of timed) {
    if (threat.lands <= now) continue;
    const colour = TONE_COLOUR[threat.tone];
    const place = threat.where;
    switch (place.kind) {
      case "tiles": {
        const opacity = place.tiles.length >= MARK.wideFrom ? MARK.wide : MARK.tiles;
        for (const tile of place.tiles) marks.push({ tile, colour, opacity, inset: MARK.inset });
        break;
      }
      case "spot": {
        const tile = place.at.kind === "boss" ? null : spotTile(place.at, where);
        if (tile) marks.push({ tile, colour, opacity: MARK.spot, inset: MARK.inset });
        break;
      }
      case "flight": {
        const to = place.to.kind === "boss" ? null : spotTile(place.to, where);
        if (to) marks.push({ tile: to, colour, opacity: MARK.spot, inset: MARK.inset });
        const from = spotTile(place.from, where);
        const target = spotTile(place.to, where);
        if (place.block && from && target) for (const tile of lineBetween(from, target)) marks.push({ tile, colour, opacity: MARK.line, inset: MARK.inset });
        break;
      }
      case "none":
        break;
      default: {
        const unhandled: never = place;
        return unhandled;
      }
    }
  }
  return marks;
}

/**
 * Each threat's countdown in the scene: on its tiles, on its spot, or riding its shot from where it was fired to where it
 * lands. Only the soonest countdown shows on any one point.
 */
export function mechanicLabels(timed: readonly Timed[], where: Whereabouts, tickPercent: number): readonly MechanicLabel[] {
  const labels = new Map<string, MechanicLabel & Readonly<{ inTicks: number }>>();
  for (const { threat, now } of timed) {
    const inTicks = threat.lands - now;
    if (inTicks <= 0) continue;
    const point = labelPoint(threat, now, where, tickPercent);
    if (point === null) continue;
    const key = `${Math.round(point.x * 4)},${Math.round(point.z * 4)}`;
    const held = labels.get(key);
    if (held && held.inTicks <= inTicks) continue;
    labels.set(key, { ...point, text: `${inTicks}t`, colour: TONE_COLOUR[threat.tone], inTicks });
  }
  return [...labels.values()].map(({ x, z, text, colour }) => ({ x, z, text, colour }));
}

function labelPoint(threat: Threat<ATile>, now: number, where: Whereabouts, tickPercent: number): Readonly<{ x: number; z: number }> | null {
  const place = threat.where;
  switch (place.kind) {
    case "tiles": {
      const middle = place.tiles[Math.floor(place.tiles.length / 2)];
      return middle ?? null;
    }
    case "spot":
      return spotPoint(place.at, where);
    case "flight": {
      const from = spotPoint(place.from, where);
      const to = spotPoint(place.to, where);
      if (from === null || to === null) return null;
      // A blockable heal fires when its countdown ends, from its source: the count waits there, over the line to stand on.
      if (place.block) return from;
      const flight = Math.max(1, threat.lands - threat.told);
      const done = Math.min(1, Math.max(0, (now - threat.told + tickPercent) / flight));
      return { x: from.x + (to.x - from.x) * done, z: from.z + (to.z - from.z) * done };
    }
    case "none":
      return null;
    default: {
      const unhandled: never = place;
      return unhandled;
    }
  }
}
