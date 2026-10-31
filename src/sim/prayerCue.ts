import type { Tick } from "./brands";
import type { Style } from "./combat";

/** Each protection prayer by the style it blocks, as the game names it. */
export const PROTECTION_PRAYER: Readonly<Record<Style, string>> = { magic: "Protect from Magic", ranged: "Protect from Missiles", melee: "Protect from Melee" };

/** What the guide lights up for a tell: his footprint while the telling spotanim plays, or the tile a projectile flies to. */
export type Highlight = Readonly<{ kind: "boss" }> | Readonly<{ kind: "target" }>;

/** A prayable attack as the player can first know it: the style to pray, the tell that gives it away, and when it lands. */
export type Foretold = Readonly<{
  style: Style;
  /** The attack, short: "magic volley". */
  attack: string;
  /** What in the fight gives the style away, as the guide's "Why:" line reads it. */
  tell: string;
  /** A catch in praying it, such as a prayer the boss severs; null when the plain prayer is the whole answer. */
  caution: string | null;
  on: Highlight;
}>;

/** One foretold attack in one phase. `id` is unique within the phase; `told` and `lands` are on the phase's own clock. */
export type PrayerCue = Foretold & Readonly<{ id: number; told: Tick; lands: Tick }>;

/** A cue told, or one whose hit was called off before it landed. */
export type CueChange = Readonly<{ kind: "told"; cue: PrayerCue }> | Readonly<{ kind: "dropped"; id: number }>;
