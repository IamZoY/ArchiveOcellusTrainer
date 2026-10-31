import { createHash } from "node:crypto";
import fs from "node:fs";
import { Settings, TrainerInstance } from "osrs-sdk";
import { fullFightStaged } from "../../src/content/ocellus/full/prefix";
import { dressFullFight } from "../../src/content/ocellus/fight/blowpipe";
import type { DrillSelection } from "../../src/content/ocellus/js/OcellusTimings";
import { startDrill } from "../../src/content/ocellus/tests/drill";

type Focus = NonNullable<DrillSelection["focus"]>;
type Play = "correct" | "idle";
type FightRun = Readonly<{ name: string; seed: number; selection: DrillSelection; play: Play; to: number }>;

const FOCUSES: readonly Focus[] = ["void-floor", "floor-holes", "lifeforce-orb", "explosions", "transition-attacks", "rifts"];

const RUNS: readonly FightRun[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 100].map((seed): FightRun => ({ name: `full-correct-${seed}`, seed, selection: {}, play: "correct", to: 260 })),
  ...[1, 2, 4, 100].map((seed): FightRun => ({ name: `full-idle-${seed}`, seed, selection: {}, play: "idle", to: 200 })),
  ...FOCUSES.flatMap((focus): FightRun[] => [
    { name: `${focus}-correct`, seed: 3, selection: { focus }, play: "correct", to: 200 },
    { name: `${focus}-cycle-start`, seed: 9, selection: { focus, drillStart: "cycle-start" }, play: "correct", to: 200 },
  ]),
  { name: "replay-v2-correct", seed: 1, selection: { specialSelection: "replay-v2" }, play: "correct", to: 200 },
  { name: "holes-v1-turn", seed: 5, selection: { floorHoleLayout: "v1-turn" }, play: "correct", to: 200 },
];

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

type CarriedRun = Readonly<{ name: string; seed: number; to: number }>;

/** Phase 4 as `/` starts it, carried from the third fall, with Practice on, every choice at its default and the twisted bow in hand. */
const CARRIED: readonly CarriedRun[] = [1, 4, 14, 75].map((runSeed): CarriedRun => ({ name: `site-p4-practice-${runSeed}`, seed: runSeed, to: 200 }));

function carriedFight(run: CarriedRun) {
  Settings.readFromStorage();
  const region = fullFightStaged(
    { seed: run.seed, party: 1, startPhase: 4, hazardTiles: false, videoMarkers: false, prayerGuide: false, mechanicsGuide: false, skipMarkers: false, patternMarkers: false, soloVine: true, invincible: true, defenceDrained: false },
    (player) => dressFullFight(player, "twistedBow"),
  );
  const trainer = new TrainerInstance(region);
  trainer.mount(document.createElement("canvas"), document.createElement("div"));
  region.world.getReadyTimer = 0;
  for (let guard = 0; (region.rows("p4").at(-1)?.tick ?? 0) < run.to && region.p4.mounted?.ocellus.runState().kind !== "ended"; guard++) {
    if (guard > run.to + 20) throw new Error(`${run.name} never reached P4 tick ${run.to}`);
    region.world.tickWorld();
  }
  const log = JSON.stringify(region.rows("p4"));
  const boss = region.p4.mounted && { hp: region.p4.mounted.ocellus.currentStats.hitpoint, run: region.p4.mounted.ocellus.runState() };
  trainer.dispose();
  return { log: JSON.parse(log), snapshot: plain(boss), bytes: createHash("sha256").update(log).digest("hex") };
}

test("seeded fights", async () => {
  const out = process.env.PARITY_OUT;
  if (out === undefined) throw new Error("set PARITY_OUT to the dump's path");
  const fights: Record<string, unknown> = {};
  for (const run of RUNS) {
    const drill = startDrill({ seed: run.seed, selection: run.selection });
    switch (run.play) {
      case "correct":
        await drill.playCorrectlyTo(run.to);
        break;
      case "idle":
        drill.tickTo(run.to);
        break;
      default: {
        const unknownPlay: never = run.play;
        throw new Error(`unknown play ${String(unknownPlay)}`);
      }
    }
    const log = JSON.stringify(drill.region.fightLog());
    fights[run.name] = { log: JSON.parse(log), snapshot: plain(drill.region.snapshot()), bytes: createHash("sha256").update(log).digest("hex") };
  }
  for (const run of CARRIED) fights[run.name] = carriedFight(run);
  fs.writeFileSync(out, `${JSON.stringify(fights, null, 1)}\n`);
  expect(Object.keys(fights)).toEqual([...RUNS, ...CARRIED].map(({ name }) => name));
});
