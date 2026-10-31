import { Settings, TrainerInstance, Viewport } from "osrs-sdk";
import { QUADRANTS, GRID, quadrantOf, quadrantTiles } from "../fight/geometry";
import { FightPlayer } from "../fight/units";
import type { StartPhase } from "../full/options";
import type { FightRegion, FullFightOptions } from "../full/prefix";
import { fullFightStaged } from "../full/prefix";
import { dressFullFight } from "../fight/blowpipe";
import { OCELLUS_P4 } from "../js/OcellusTimings";

let close: (() => void) | null = null;
afterEach(() => {
  close?.();
  close = null;
});

function fullFight(startPhase: StartPhase, setup: "melee" | null = null, defenceDrained = false) {
  Settings.readFromStorage();
  const options: FullFightOptions = { seed: 1, party: 1, startPhase, hazardTiles: false, videoMarkers: false, prayerGuide: false, mechanicsGuide: false, skipMarkers: false, patternMarkers: false, soloVine: true, invincible: true, defenceDrained };
  const region = fullFightStaged(options, (player) => {
    if (setup) dressFullFight(player, setup);
  });
  const trainer = new TrainerInstance(region, { force2d: true });
  trainer.mount(document.createElement("canvas"), document.createElement("div"));
  region.world.getReadyTimer = 0;
  Viewport.viewport.resize(800, 600);
  close = () => trainer.dispose();
  return region;
}

function player(region: FightRegion): FightPlayer {
  const first = region.players[0];
  if (!(first instanceof FightPlayer)) throw new Error("the region has no full-fight player");
  return first;
}

function mountedP3(region: FightRegion) {
  const p3 = region.p3.mounted;
  if (!p3) throw new Error("phase 3 is not running");
  return p3;
}

/** The running phase's name as the HUD shows it. */
function label(region: FightRegion): string {
  switch (region.current) {
    case "p1":
      return region.p1.mounted?.started() ? "Phase 1" : "";
    case "p2":
      return "Phase 2";
    case "p3":
      return "Phase 3";
    case "p4":
      return "Phase 4";
    default: {
      const unhandled: never = region.current;
      return unhandled;
    }
  }
}

/** Standing on a quadrant when it falls kills the player, so leave each one as it crumbles. */
function stepOff(region: FightRegion): void {
  const here = quadrantOf(player(region).arenaTile());
  const fallen = region.floorState().destroyed;
  const next = QUADRANTS.find((q) => q !== here && !fallen.includes(q));
  if (!next) throw new Error("no quadrant left to stand on");
  const floor = quadrantTiles(next).find((t) => mountedP3(region).arena.isWalkable(t));
  if (!floor) throw new Error(`no floor in ${next}`);
  player(region).hop(floor);
}

/** Phases 1 to 3 at speed: each pool drops to its floor at once, and the player leaves every crumbling quadrant. Returns the third fall's world tick. */
function toThirdFall(region: FightRegion, each: () => void = () => undefined): number {
  for (let step = 0; step < 2500; step++) {
    region.world.tickWorld();
    if (region.floorState().destroyed.length === 3) return region.world.globalTickCounter;
    each();
    const boss = region.p1?.mounted?.boss;
    if (region.current === "p1" && boss && boss.form === "p1" && boss.currentStats.hitpoint > 0) boss.currentStats.hitpoint = 0;
    if (region.current === "p3") {
      const { boss: his, script } = mountedP3(region);
      his.currentStats.hitpoint = Math.min(his.currentStats.hitpoint, script.hpFloor(his.stats.hitpoint));
      const crumbling = region.floorState().crumbling;
      if (crumbling.length > 0 && quadrantOf(player(region).arenaTile()) === crumbling[0]) stepOff(region);
    }
  }
  throw new Error("phase 3 never fell for the third time");
}

function mountedP4(region: FightRegion) {
  const p4 = region.p4.mounted;
  if (!p4) throw new Error("P4 did not mount");
  return p4;
}

describe("phase 2 hands over to phase 3 on the engine", () => {
  test("phase 3's tick 0 is P2's tick 131, his own phase 3's first tick, with the pool's HP as it stands", () => {
    const region = fullFight(2);
    for (let guard = 0; region.current === "p2"; guard++) {
      if (guard > 300) throw new Error("phase 2 never handed over");
      const p2 = region.p2.mounted;
      if (p2?.now() === 120) p2.boss.currentStats.hitpoint = 4321;
      region.world.tickWorld();
    }
    region.world.tickWorld();
    expect({
      from: region.startOf("p3"),
      last: region.rows("p2").at(-1)?.tick,
      p3: region.rows("p3").map((row) => [row.tick, row.worldTick - (region.rows("p3")[0]?.worldTick ?? 0)]),
      hp: mountedP3(region).boss.currentStats.hitpoint,
      label: label(region),
    }).toEqual({ from: 131, last: 130, p3: [[0, 0]], hp: 4321, label: "Phase 3" });
  });
});

describe("the third fall enters P4 in the same world", () => {
  test("seed 1 runs from phase 1 to P4's kill, and P4's section logs a deflected hit's reflection", () => {
    const region = fullFight(1, "melee");
    const labels: string[] = [];
    toThirdFall(region, () => {
      const now = label(region);
      if (now !== "" && labels[labels.length - 1] !== now) labels.push(now);
    });
    const p4 = region.p4.mounted;
    const reflected = () => region.rows("p4").some((row) => row.events.some((event) => event.kind === "deflect-reflected"));
    for (let step = 0; p4 && step < 3000 && p4.ocellus.runState().kind !== "ended"; step++) {
      const { ocellus, player } = p4;
      if (!player.aggro && ocellus.canBeAttacked()) player.setAggro(ocellus);
      // A player who neither prays nor takes the orbs loses ground to his heals, so once a hit has been deflected the next landed hit is the kill.
      if (reflected() && ocellus.currentStats.hitpoint > 1) ocellus.currentStats.hitpoint = 1;
      region.world.tickWorld();
    }
    expect({
      labels,
      phases: region.sections().map((section) => section.phase),
      run: p4?.ocellus.runState().kind ?? null,
      end: region.rows("p4").flatMap((row) => row.events.flatMap((event) => (event.kind === "run-ended" ? [event.reason] : []))),
      reflected: reflected(),
    }).toEqual({ labels: ["Phase 1", "Phase 2", "Phase 3"], phases: ["p1", "p2", "p3", "p4"], run: "ended", end: ["kill"], reflected: true });
  }, 120000);

  test("P4 opens on the next world tick with no GET READY, and the boss is hidden for the 4 ticks from the fall", () => {
    const region = fullFight(3);
    const shown: boolean[] = [];
    const bossShown = () => (region.current === "p4" ? mountedP4(region).ocellus.visible() : mountedP3(region).boss.visible());
    const fellAt = toThirdFall(region, () => {
      shown.splice(0, shown.length, bossShown());
    });
    shown.push(bossShown());
    for (let world = 0; world < 5; world++) {
      region.world.tickWorld();
      shown.push(bossShown());
    }
    const [first] = region.rows("p4");
    expect({ getReady: region.world.getReadyTimer, firstRow: first && [first.tick, first.worldTick - fellAt], shown }).toEqual({
      getReady: 0,
      firstRow: [1, 1],
      shown: [true, false, false, false, false, true, true],
    });
  });

  test("phase 3's mobs stay behind, the tiles off the last floor are shut, and it opens no tick after its fall", () => {
    const region = fullFight(3);
    toThirdFall(region);
    const fellAt = region.rows("p3").at(-1)?.tick ?? -1;
    for (let world = 0; world < 40; world++) region.world.tickWorld();
    const counts: Record<string, number> = {};
    for (const entity of region.entities) counts[entity.constructor.name] = (counts[entity.constructor.name] ?? 0) + 1;
    const mobs = [...region.mobs, ...region.newMobs].map((mob) => mob.constructor.name);
    const floorTiles = [...OCELLUS_P4.geometry.platform.value.join("")].filter((cell) => cell === "#").length;
    expect({ p3Ticks: (region.rows("p3").at(-1)?.tick ?? -1) - fellAt, mounted: region.p3.mounted, fallen: region.floorState().destroyed.length, mobs, counts }).toEqual({
      p3Ticks: 0,
      mounted: null,
      fallen: 3,
      mobs: ["Ocellus"],
      // The two TileMarks and the SceneLabels are the prayer and mechanics guides' marks, which the region keeps for the whole run.
      counts: { ArenaFloor: 1, LocField: 1, InvisibleMovementBlocker: GRID * GRID - floorTiles, VoidField: 1, FloorHole: 3, OrbView: 2, FragmentFlash: 1, BossFootprint: 1, TileMarks: 2, SceneLabels: 1 },
    });
  });

  test("phase 3's drained Defence, which his own floor holds at 150, crosses into P4", () => {
    const region = fullFight(3);
    toThirdFall(region, () => {
      if (region.p3.mounted) region.p3.mounted.boss.currentStats.defence = 40;
    });
    const { ocellus } = mountedP4(region);
    expect([ocellus.currentStats.defence, ocellus.stats.defence]).toEqual([150, 250]);
  });

  test("Defence drained opens phases 1 to 3 at his floor (The Blade has none), carries phase 3's into P4, and a further drain stops there", () => {
    const run = (defenceDrained: boolean) => {
      const region = fullFight(1, null, defenceDrained);
      const opened: Partial<Record<"p1" | "p2" | "p3", number>> = {};
      toThirdFall(region, () => {
        const phase = region.current;
        if (phase === "p4") return;
        const boss = { p1: region.p1.mounted?.boss, p2: region.p2.mounted?.boss, p3: region.p3.mounted?.boss }[phase];
        if (boss && boss.form !== "hooded" && opened[phase] === undefined) opened[phase] = boss.currentStats.defence;
      });
      const { ocellus } = mountedP4(region);
      const p4 = ocellus.currentStats.defence;
      ocellus.currentStats.defence = 0;
      const drainedAgain = ocellus.currentStats.defence;
      close?.();
      close = null;
      return { ...opened, p4, drainedAgain };
    };
    expect({ drained: run(true), full: run(false) }).toEqual({
      drained: { p1: 129, p2: 0, p3: 150, p4: 150, drainedAgain: 150 },
      full: { p1: 215, p2: 250, p3: 250, p4: 250, drainedAgain: 150 },
    });
  }, 120000);
});
