import type { Tick } from "../../../../sim/brands";
import type { Entries } from "../../../../sim/encounter";
import type { Ctx, ScriptRow } from "../../../../sim/script";
import type { BossOverhead } from "../data/looks";
import type { ATile, Quadrant } from "../../fight/geometry";

export type Element = "fire" | "water";
export type Tendril = "x" | "z" | "corner";
export type Side = "east" | "south" | "west" | "north";

/** Every way phase 1 hurts or heals. One kind per row in the replay table. */
export type P1Cause =
  | Readonly<{ kind: "volley"; element: Element }>
  | Readonly<{ kind: "blast" }>
  | Readonly<{ kind: "crack" }>
  | Readonly<{ kind: "strike" }>
  | Readonly<{ kind: "block" }>
  | Readonly<{ kind: "line" }>
  | Readonly<{ kind: "strike-open" }>;

export type P1Event =
  | Readonly<{ kind: "opened"; at: Tick }>
  | Readonly<{ kind: "revealed"; at: Tick }>
  | Readonly<{ kind: "volley"; at: Tick; element: Element }>
  | Readonly<{ kind: "arrived"; at: Tick; corner: Quadrant }>
  | Readonly<{ kind: "charged"; at: Tick; corner: Quadrant }>
  | Readonly<{ kind: "cracks"; at: Tick; count: number }>
  | Readonly<{ kind: "exploded"; at: Tick }>
  | Readonly<{ kind: "blasted"; at: Tick }>
  | Readonly<{ kind: "middle"; at: Tick }>
  | Readonly<{ kind: "strike"; at: Tick; shots: number }>
  | Readonly<{ kind: "ending"; at: Tick }>
  | Readonly<{ kind: "leaving"; at: Tick }>
  | Readonly<{ kind: "player-died"; at: Tick }>;

export type Growth = Readonly<{ dx: number; dz: number }>;

/** What the presenter draws. Each is logged in the row, so replaying the rows redraws the phase. */
export type P1Look =
  | Readonly<{ kind: "chat"; text: string }>
  | Readonly<{ kind: "projectile"; element: Element; near: boolean; flight: number }>
  | Readonly<{ kind: "player-spot"; id: number }>
  | Readonly<{ kind: "cracks"; tiles: readonly ATile[]; growth: Growth; closesAfter: number }>
  | Readonly<{ kind: "cracks-end"; tiles: readonly ATile[]; growth: Growth }>
  | Readonly<{ kind: "floor-spots"; spots: readonly Readonly<{ tile: ATile; id: number; delay: number }>[] }>
  | Readonly<{ kind: "strike"; shots: number; flight: number }>
  | Readonly<{ kind: "sound"; id: number; at: ATile }>
  | Readonly<{ kind: "clear-cracks" }>
  | Readonly<{ kind: "blast-mark"; tiles: readonly ATile[] }>
  | Readonly<{ kind: "blast-clear" }>;

export type P1Roll =
  | "opening-element"
  | "element"
  | "first-corner"
  | "tendril-order"
  | "corner-tendril"
  | "straight"
  | "route"
  | "shout"
  | "side"
  | "blast-graphic"
  | "crack-sound";

export type P1Types = Readonly<{
  tile: ATile;
  cause: P1Cause;
  event: P1Event;
  look: P1Look;
  roll: P1Roll;
  overhead: BossOverhead;
  input: unknown;
}>;

export type P1Row = ScriptRow<P1Types>;
export type P1Ctx<E extends Entries> = Ctx<E, P1Types>;

/** A full fight opens phase 1 here. There is no carried entry: the hooded intro is the start. */
export type P1Entry = Readonly<{ kind: "fresh" }>;

/** The phase has no win of its own. The page can still show the victory panel, and a death ends the run. */
export type P1Outcome = Readonly<{ kind: "running" }> | Readonly<{ kind: "won"; at: Tick }> | Readonly<{ kind: "lost"; at: Tick }>;

/**
 * Walking to a corner, charging there, the middle at a health threshold, or the ending teleport.
 * Arriving is the intro, before the first step.
 */
export type P1Stage =
  | Readonly<{ kind: "arriving" }>
  | { kind: "walking"; to: Quadrant; startedAt: Tick; arrivedAt: Tick | null; volleys: boolean }
  | Readonly<{ kind: "corner"; at: Quadrant }>
  | Readonly<{ kind: "middle"; next: Quadrant }>
  | Readonly<{ kind: "ending" }>;
