import type { Tick } from "../../../../sim/brands";
import type { Entries } from "../../../../sim/encounter";
import type { Ctx, ScriptRow } from "../../../../sim/script";
import type { ATile } from "../../fight/geometry";

/** Every way phase 2 hurts the player. One kind per row in the replay table. */
export type P2Cause = Readonly<{ kind: "line" }>;

export type P2Event =
  | Readonly<{ kind: "blade-woke"; at: Tick }>
  | Readonly<{ kind: "portals-rose"; at: Tick }>
  | Readonly<{ kind: "portals-lit"; at: Tick }>
  | Readonly<{ kind: "pools-opened"; at: Tick; count: number }>
  | Readonly<{ kind: "safe-opened"; at: Tick; tile: ATile }>
  | Readonly<{ kind: "escaped"; at: Tick; to: ATile }>
  | Readonly<{ kind: "volley"; at: Tick; crossfire: boolean; speed: number; lines: readonly (readonly ATile[])[] }>
  | Readonly<{ kind: "enough"; at: Tick }>
  | Readonly<{ kind: "leaving"; at: Tick }>
  | Readonly<{ kind: "player-died"; at: Tick }>;

export type Tone = "game" | "purple";
export type MarkRole = "wave" | "cross" | "lane" | "pool" | "escape";
export type GroundEffect = "repair" | "pools" | "safe-spawn" | "safe-idle" | "safe-despawn" | "sword-drop" | "sword-explosion";

export type PortalFace = Readonly<{ tiles: readonly [ATile, ATile]; rotation: number; lit: boolean }>;

/** What the presenter draws. Each is logged in the row, so replaying the rows redraws the fight. */
export type P2Look =
  | Readonly<{ kind: "chat"; text: string; tone: Tone }>
  | Readonly<{ kind: "portals"; faces: readonly PortalFace[] }>
  | Readonly<{ kind: "marks"; tiles: readonly Readonly<{ tile: ATile; role: MarkRole }>[] }>
  | Readonly<{ kind: "ground"; effect: GroundEffect; tiles: readonly ATile[] }>
  | Readonly<{ kind: "player-spot"; id: number; channel: string }>
  | Readonly<{ kind: "sound"; id: number; at: ATile }>;

export type P2Roll = "gap-sequence" | "pool-tile" | "safe-tile" | "escape-tile";

export type P2Types = Readonly<{
  tile: ATile;
  cause: P2Cause;
  event: P2Event;
  look: P2Look;
  roll: P2Roll;
  overhead: never;
  input: unknown;
}>;

export type P2Row = ScriptRow<P2Types>;
export type P2Ctx<E extends Entries> = Ctx<E, P2Types>;

/**
 * Phase 2 from the fight's start, or after phase 1. Both open the blade at full pool: his swap resets it,
 * rather than carrying the pool phase 1 emptied.
 */
export type P2Entry = Readonly<{ kind: "opening" }> | Readonly<{ kind: "followed" }>;

/** Phase 2 has no win of its own: the run goes on into phase 3, or ends on the death screen. */
export type P2Outcome = Readonly<{ kind: "running" }> | Readonly<{ kind: "lost"; at: Tick }>;

/** Arriving, the rounds, then the blade calling enough. The round itself stays inside the script. */
export type P2Stage = Readonly<{ kind: "arriving" }> | Readonly<{ kind: "open" }> | Readonly<{ kind: "enough" }>;
