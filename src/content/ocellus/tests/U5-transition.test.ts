import type { DrillSelection } from "../js/OcellusTimings";
import { UNDER_BOSS, startDrill } from "./drill";

const REPLAY_V2 = { focus: "transition-attacks", specialSelection: "replay-v2" } as const;

describe("U5 transition attacks", () => {
  test("each tell names its variant's style 5 ticks before the hit, and with no prayer every hit takes the unprotected roll", () => {
    const drill = startDrill({ selection: REPLAY_V2 });
    drill.tickTo(98);
    expect(drill.events("special-told").map((e) => [e.at, e.ordinal, e.variant, e.style])).toEqual([
      [32, 0, "vortex", "magic"], [60, 1, "spike-disk", "ranged"], [92, 2, "black-disk", "melee"],
    ]);
    expect(drill.events("special-hit").map((e) => [e.at, e.ordinal, e.style, e.receipt])).toEqual([
      [37, 0, "magic", { requested: 49, applied: 49, beforeHp: 99, afterHp: 50, prayer: null }],
      [65, 1, "ranged", { requested: 47, applied: 47, beforeHp: 50, afterHp: 3, prayer: null }],
      [97, 2, "melee", { requested: 49, applied: 3, beforeHp: 3, afterHp: 0, prayer: null }],
    ]);
    expect(drill.events("run-ended").map((e) => [e.at, e.reason])).toEqual([[97, "death"]]);
    drill.dispose();
  });

  test.each([
    { when: "Protect from Magic clicked after tick 36 is up when the vortex lands", prayer: "Protect from Magic", clicks: [36], atTell: null, hit: [37, { requested: 11, applied: 11, beforeHp: 99, afterHp: 88, prayer: "magic" }] },
    { when: "Protect from Magic clicked after the landing tick is late", prayer: "Protect from Magic", clicks: [37], atTell: null, hit: [37, { requested: 49, applied: 49, beforeHp: 99, afterHp: 50, prayer: null }] },
    { when: "Protect from Melee does not protect from the vortex", prayer: "Protect from Melee", clicks: [36], atTell: null, hit: [37, { requested: 49, applied: 49, beforeHp: 99, afterHp: 50, prayer: "melee" }] },
    { when: "Protect from Magic up at the tell and off before the landing does not protect", prayer: "Protect from Magic", clicks: [31, 35], atTell: "magic", hit: [37, { requested: 49, applied: 49, beforeHp: 99, afterHp: 50, prayer: null }] },
  ] as const)("the prayer is judged when the hit lands: $when", ({ prayer, clicks, atTell, hit }) => {
    const drill = startDrill({ selection: REPLAY_V2 });
    for (const after of clicks) {
      drill.tickTo(after);
      drill.pray(prayer);
    }
    drill.tickTo(38);
    expect([drill.row(32).playerAtBossStep.prayer, drill.events("special-hit").map((e) => [e.at, e.receipt])]).toEqual([atTell, [hit]]);
    drill.dispose();
  });

  test("a protected transition hit can take 12, the most six raid logs record under the right prayer: seed 5's vortex under Protect from Magic", () => {
    const drill = startDrill({ seed: 5, selection: REPLAY_V2 });
    drill.tickTo(36);
    drill.pray("Protect from Magic");
    drill.tickTo(38);
    expect(drill.events("special-hit").map((e) => [e.at, e.receipt])).toEqual([[37, { requested: 12, applied: 12, beforeHp: 99, afterHp: 87, prayer: "magic" }]]);
    drill.dispose();
  });

  test("the boss starts landing a tick before each inner void clears", async () => {
    const drill = startDrill({ selection: REPLAY_V2 });
    await drill.playCorrectlyTo(90);
    const clears = drill.events("stage-entered").filter((e) => e.stage === "after-inner");
    expect([drill.events("boss-landing-started").map((e) => e.at), clears.map((e) => e.at)]).toEqual([[29, 89], [30, 90]]);
    drill.dispose();
  });

  test("each style's sounds follow its own tell on the cue audit's ticks, and a drill without transition attacks plays none", () => {
    const sounded = (selection: DrillSelection) => {
      const drill = startDrill({ selection });
      drill.tickTo(98);
      const cues = drill.events("special-sounded").map((e) => [e.at, e.ordinal, e.cue.sound, e.cue.delayMs]);
      drill.dispose();
      return cues;
    };
    expect([sounded(REPLAY_V2), sounded({ focus: "lifeforce-orb", specialSelection: "replay-v2" })]).toEqual([
      [[34, 0, "magicWindUp", 120], [64, 1, "rangedBeforeHit", 240], [65, 1, "rangedHit", 60], [92, 2, "meleeTell", 60], [97, 2, "meleeHit", 60]],
      [],
    ]);
  });

  test("standing under the boss gives no cover from the transition attack", () => {
    const drill = startDrill({ selection: REPLAY_V2 });
    drill.tickTo(31);
    drill.walkTo(UNDER_BOSS);
    drill.tickTo(37);
    expect([drill.row(37).playerAtBossStep.tile, drill.events("special-hit").map((e) => [e.at, e.receipt.applied])]).toEqual([{ x: 5, y: 5 }, [[37, 49]]]);
    drill.dispose();
  });
});
