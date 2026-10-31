import type { Replays } from "../../../../sim/script";
import type { FightLog } from "../../js/OcellusTimings";
import type { P3Types } from "./types";

/**
 * Where fight logs L1 and L6 show each of phase 3's hits and events, by the log's own P3 tick. A solo run that stands
 * where those raiders stood reproduces each list; `P3Replay.test.ts` plays both runs.
 */
export const P3_REPLAYS: Replays<P3Types, FightLog> = {
  swing: { kind: "log", log: "L1", at: "L1.txt:2428 anim 14842 at P3 +10", ticks: [10, 13, 20, 23, 39, 42, 49, 52] },
  panic: { kind: "log", log: "L1", at: "L1.txt:3049 magic at P3 +113, 4297 cast at +111", ticks: [113] },
  slash: { kind: "log", log: "L1", at: "L1.txt:2511 floor 4335 at P3 +17", ticks: [17, 27, 46, 56] },
  "spin-opening": { kind: "log", log: "L1", at: "L1.txt:2583 melee at P3 +31, the spin at +30", ticks: [31] },
  saw: { kind: "log", log: "L1", at: "L1.txt:2629 anim 14871 at P3 +35", ticks: [35] },
  bomb: { kind: "log", log: "L1", at: "L1.txt:2454 floor 4301 at P3 +12", ticks: [12, 15] },
  debris: { kind: "log", log: "L1", at: "L1.txt:2639 hits under the rubble at P3 +38, floor 4346 at +33", ticks: [38] },
  "superior-slash": { kind: "log", log: "L1", at: "L1.txt:3387 floor 4336 at P3 +171", ticks: [171, 176, 181] },
  "rift-detonation": { kind: "unlogged", why: "raiders killed every rift in L1 and L6; his K case pins the 30-tick detonation" },
  "rift-heal": { kind: "unlogged", why: "the logs do not tell a siphon's heal from the boss's other HP changes" },
  "siphon-kill": { kind: "unlogged", why: "raiders kill siphons; the tick is theirs, and the 22 is the wiki's" },
  "void-patch": { kind: "unlogged", why: "a patch hits only a raider standing on it, and the logs carry no patch hits apart from others" },
  "untether-magic": { kind: "log", log: "L1", at: "L1.txt:2837 magic at P3 +69, Untether at +59", ticks: [69, 73, 77, 81] },
  slam: { kind: "log", log: "L1", at: "L1.txt:2981 the raider outside takes 36 at P3 +88", ticks: [88] },
  aftershock: { kind: "log", log: "L6", at: "L6.txt:3539 the two still under take 40 and 35 at P3 +89", ticks: [89] },
  "segment-started": { kind: "log", log: "L1", at: "L1.txt:2421 segment starts at P3 +6, and at +107", ticks: [6, 107] },
  "special-started": { kind: "log", log: "L1", at: "L1.txt:2582 spin at P3 +30, Untether +59, spin +134, Insolence +166", ticks: [30, 59, 134, 166] },
  "prayer-severed": { kind: "unlogged", why: "the logs carry no raider's prayer state" },
  "vine-rooted": { kind: "log", log: "L6", at: "L6.txt:3346 Void Vine appears at P3 +42", ticks: [42] },
  "vine-released": { kind: "unlogged", why: "a vine lives until raiders cut it, 7 to 32 ticks in [K]" },
  "rift-spawned": { kind: "log", log: "L6", at: "L6.txt:3548, 3734, 3852 rifts at P3 +91, +139 and +188", ticks: [91, 139, 188] },
  "rift-killed": { kind: "unlogged", why: "raiders kill rifts; the tick is theirs" },
  "collapse-started": { kind: "log", log: "L1", at: "L1.txt:2991 \"Run... It matters not...\" at P3 +90", ticks: [90] },
  "quadrant-fell": { kind: "unlogged", why: "the logs mark the collapse and the next segment; the floor's removal 13 ticks in is his [R] value" },
  "player-consumed": { kind: "unlogged", why: "nobody stood on a falling quadrant in the logs" },
  "crossing-started": { kind: "unlogged", why: "a crossing starts on the player's click" },
  "censer-lit": { kind: "unlogged", why: "a censer lights on the player's click" },
  "player-died": { kind: "unlogged", why: "the death screen follows the SDK's death timer, not a mark of his in the logs" },
};
