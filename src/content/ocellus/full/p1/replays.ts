import type { Replays } from "../../../../sim/script";
import type { FightLog } from "../../js/OcellusTimings";
import type { P1Types } from "./types";

/**
 * L1's phase clock includes the ready wait. "Now... ascension..." at L1.txt:11 is P1 +26, which is this script's tick 0.
 * The first volley animation at L1.txt:18 is P1 +30, script tick 4. L2 has no intro-aligned clock: L2.txt:273 is a corner
 * shout at P1 +22, and that tick depends on which corner he rolled.
 */
export const P1_REPLAYS: Replays<P1Types, FightLog> = {
  volley: { kind: "log", log: "L1", at: "L1.txt:18 anim 14806 at P1 +30, script tick 4", ticks: [4] },
  blast: { kind: "unlogged", why: "a blast hits only a raider within two tiles of him, and the logs do not name it apart from other damage" },
  strike: { kind: "unlogged", why: "the strike's shot count follows the meter, which follows which cracks were stood on" },
  crack: { kind: "unlogged", why: "the chip lands as each crack closes, and that tick follows the corner roll; L1.txt:122-131 has every raider take 3 to 5 on the close at P1 +46" },
  block: { kind: "unlogged", why: "a crack heals only the raider standing on it as it closes" },
  line: { kind: "unlogged", why: "a missed crack heals him by 2, which the logs do not separate from other heals" },
  "strike-open": { kind: "unlogged", why: "the green heal before the strike is one roll, and the logs do not mark it" },
  opened: { kind: "log", log: "L1", at: 'L1.txt:11 says "Now... ascension..." at P1 +26, script tick 0', ticks: [0] },
  revealed: { kind: "unlogged", why: "the hood comes off one tick after the shout; the logs do not mark that swap" },
  arrived: { kind: "unlogged", why: "which corner he reaches, and on which tick, is the first-corner roll" },
  charged: { kind: "unlogged", why: "the charge follows the corner he rolled, so the tick is not fixed" },
  cracks: { kind: "unlogged", why: "tendril direction is rolled per line, so the tiles are not fixed" },
  exploded: { kind: "unlogged", why: "the explosion is 18 ticks after the charge, and the charge tick is the corner roll" },
  blasted: { kind: "unlogged", why: "the blast is the tick after the explosion, on the same rolled clock" },
  middle: { kind: "unlogged", why: "the 66% and 25% teleports wait on his HP, which the logs do not share with a solo seed" },
  ending: { kind: "unlogged", why: "the ending starts when his HP reaches 0, and the logs do not pin that tick" },
  leaving: { kind: "unlogged", why: "phase 2's tick 0 is the tick after this phase asks to leave" },
  "player-died": { kind: "unlogged", why: "the death screen follows the SDK's death timer, not a mark of his in the logs" },
};
