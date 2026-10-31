import type { Tick } from "./brands";

/** Where a mark sits: a fixed tile, the player as they stand, or his body as it stands. */
export type Spot<Tile> = Readonly<{ kind: "tile"; tile: Tile }> | Readonly<{ kind: "player" }> | Readonly<{ kind: "boss" }>;

/**
 * What the mechanics guide draws for a threat: tiles to leave, a spot to watch, a shot in flight from one spot to another
 * (`block` when standing on its line stops it), or nothing on the floor at all.
 */
export type Where<Tile> =
  | Readonly<{ kind: "tiles"; tiles: readonly Tile[] }>
  | Readonly<{ kind: "spot"; at: Spot<Tile> }>
  | Readonly<{ kind: "flight"; from: Spot<Tile>; to: Spot<Tile>; block: boolean }>
  | Readonly<{ kind: "none" }>;

/** Harm to dodge or survive, a heal to stop, or a beat of the fight to time against. */
export type Tone = "harm" | "heal" | "beat";

/** A telegraphed mechanic as the player can first know it: what it is, what to do, and where it lands. */
export type Warning<Tile> = Readonly<{ what: string; todo: string; tone: Tone; where: Where<Tile> }>;

/** One warning in one phase. `id` is unique within the phase; `told` and `lands` are on the phase's own clock. */
export type Threat<Tile> = Warning<Tile> & Readonly<{ id: string; told: Tick; lands: Tick }>;

/** A threat told, or one called off before it landed. */
export type ThreatChange<Tile> = Readonly<{ kind: "told"; threat: Threat<Tile> }> | Readonly<{ kind: "dropped"; id: string }>;
