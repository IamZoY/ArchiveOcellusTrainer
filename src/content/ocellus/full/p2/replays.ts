import type { Replays } from "../../../../sim/script";
import type { FightLog } from "../../js/OcellusTimings";
import type { P2Types } from "./types";

/**
 * L1's portals-lit ticks: six lights a round, plus the all-lit beat on the first two rounds.
 * L2 records the same offsets on the lines it wrote (L2.txt:909 and on); it skips +42, +53, +84 and +95.
 */
const LIT = [11, 16, 21, 26, 31, 36, 42, 53, 58, 63, 68, 73, 78, 84, 95, 100, 105, 110, 115, 120] as const;

/**
 * Where fight logs L1 and L2 show phase 2's marks, by the log's own P2 tick. A run that starts at phase 2
 * reproduces the lists; the ticks do not depend on where anyone stood.
 */
export const P2_REPLAYS: Replays<P2Types, FightLog> = {
  line: { kind: "unlogged", why: "a line hits only a raider standing on the wave, and the logs do not separate that from other damage" },
  "blade-woke": { kind: "log", log: "L1", at: "L1.txt:2204 and L2.txt:902 say \"Your time... comes...\" at P2 +7", ticks: [7] },
  "portals-rose": { kind: "unlogged", why: "the cross is up from tick 2; the logs mark portals when they light, at +11" },
  "portals-lit": { kind: "log", log: "L1", at: "L1.txt:2220 portals lit at P2 +11, through L1.txt:2389 at +120", ticks: LIT },
  "pools-opened": { kind: "log", log: "L1", at: "L1.txt:2252 floor 4270 at P2 +39, and at +81", ticks: [39, 81] },
  "safe-opened": { kind: "log", log: "L1", at: "L1.txt:2272 floor 4271 at P2 +44, and L1.txt:2340 at +86", ticks: [44, 86] },
  escaped: { kind: "unlogged", why: "the hop happens only when a raider stands on the safe portal" },
  volley: { kind: "unlogged", why: "the logs annotate volley +N on the portals-lit line, four ticks on, which is not his slower all-twelve volley" },
  enough: { kind: "log", log: "L1", at: "L1.txt:2392 and L2.txt:2037 say \"This... is enough...\" at P2 +123", ticks: [123] },
  leaving: { kind: "unlogged", why: "the logs mark P3 +0 at tick 131, the tick after this phase asks to leave" },
  "player-died": { kind: "unlogged", why: "the death screen follows the SDK's death timer, not a mark of his in the logs" },
};
