import { Settings, TrainerInstance } from "osrs-sdk";
import type { Quadrant } from "../fight/geometry";
import { QUADRANTS, at, quadrantTiles, toSdk } from "../fight/geometry";
import { carriedEntry, quadrantFrame } from "../full/fall";
import type { Fall } from "../full/p3/types";
import { OCELLUS_P4, fullFightConfig } from "../js/OcellusTimings";
import type { LingeringVoid } from "../js/P4Types";
import type { P4Entry, P4Watch } from "../js/p4/phase";
import { p4Phase } from "../js/p4/phase";
import { seed, span, tick, tile } from "../../../sim/brands";
import { toRoom } from "../../../sim/frame";
import { EncounterRegion } from "../../../sim/sdk/EncounterRegion";
import { fence } from "../../../sim/sdk/fence";

type Tiles = readonly Readonly<{ x: number; y: number }>[];
const PLATFORM = OCELLUS_P4.geometry.platform.value.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "#" ? [tile(x, y)] : [])));
const sorted = (tiles: Tiles) => tiles.map(({ x, y }) => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

let close: (() => void) | null = null;
afterEach(() => {
  close?.();
  close = null;
});

/** P4 carried into one quadrant of his arena: the room is his 29-tile grid and the fall is given. */
function carriedP4(standing: Quadrant, voids: Fall["voids"] = [], defence = 250) {
  Settings.readFromStorage();
  const entry: P4Entry = carriedEntry({ tick: tick(100), standing, boss: { hp: 1313, defence }, voids }, fullFightConfig(seed(1)));
  const frame = quadrantFrame(standing);
  const watch: P4Watch = { invincible: true, mounted: null };
  const region = new EncounterRegion({
    room: { size: frame.size, drawFloor() {}, mount: (on) => ({ dispose() {}, walkable: (tiles) => void fence(on, tiles) }), spawn: toRoom(frame, OCELLUS_P4.geometry.playerSpawn.value) },
    phases: { p4: p4Phase<Readonly<{ p4: P4Entry }>>(watch, () => undefined) },
    start: { phase: "p4", entry },
    seed: seed(1),
  });
  const trainer = new TrainerInstance(region);
  trainer.mount(document.createElement("canvas"), document.createElement("div"));
  region.world.getReadyTimer = 0;
  close = () => trainer.dispose();
  const tickTo = (t: number) => {
    while ((region.rows("p4").at(-1)?.tick ?? 0) < t) region.world.tickWorld();
  };
  const p4 = watch.mounted;
  if (!p4) throw new Error("P4 did not mount");
  return { region, p4, tickTo };
}

describe("P4 in his arena", () => {
  test.each([
    { standing: "SE", boss: [19, 21], holes: [[26, 16], [26, 17], [26, 18]], orb: [16, 20], rifts: [[17, 16], [19, 17]] },
    { standing: "SW", boss: [7, 21], holes: [[10, 26], [11, 26], [12, 26]], orb: [8, 16], rifts: [[11, 19], [12, 17]] },
    { standing: "NW", boss: [7, 9], holes: [[2, 10], [2, 11], [2, 12]], orb: [12, 8], rifts: [[9, 11], [11, 12]] },
    { standing: "NE", boss: [19, 9], holes: [[16, 2], [17, 2], [18, 2]], orb: [20, 12], rifts: [[16, 11], [17, 9]] },
  ] as const)("in the $standing quadrant the boss, holes, first orb and first rifts stand on literal room tiles", ({ standing, boss, holes, orb, rifts }) => {
    const { region, p4, tickTo } = carriedP4(standing);
    tickTo(12);
    const orbAt = p4.views.orbs["inner-void"].location;
    tickTo(67);
    expect({
      boss: [p4.ocellus.location.x, p4.ocellus.location.y],
      holes: sorted(region.entities.filter((entity) => entity.constructor.name === "FloorHole").map((hole) => hole.location)),
      orb: [orbAt.x, orbAt.y],
      rifts: sorted([...region.mobs, ...region.newMobs].filter((mob) => mob.constructor.name === "VoidRift").map((rift) => rift.location)),
    }).toEqual({ boss, holes, orb, rifts });
  });

  test("P4's platform is each quadrant less its inner corner, which the room fences", () => {
    const off = QUADRANTS.map((q) => {
      const platform = new Set(PLATFORM.map((local) => toRoom(quadrantFrame(q), local)).map(({ x, y }) => `${x},${y}`));
      const quadrant = quadrantTiles(q).map(toSdk);
      return [q, quadrant.length, platform.size, quadrant.filter(({ x, y }) => !platform.has(`${x},${y}`)).map(({ x, y }) => [x, y])];
    });
    expect(off).toEqual([
      ["NE", 85, 84, [[16, 12]]],
      ["SE", 85, 84, [[16, 16]]],
      ["SW", 85, 84, [[12, 16]]],
      ["NW", 85, 84, [[12, 12]]],
    ]);
  });

  test("a carried Defence below P4's floor enters at the floor, and one above it as carried", () => {
    const drained = carriedP4("SE", [], 40).p4.ocellus.currentStats.defence;
    close?.();
    const kept = carriedP4("SE", [], 200).p4.ocellus.currentStats.defence;
    expect([drained, kept]).toEqual([150, 200]);
  });

  test("phase 3's voids hurt in P4 on every second tick counted from when they dropped", () => {
    // P4's spawn, local (5, 1), is arena (6, -2) in the south-east quadrant.
    const onSpawn = at(6, -2);
    const entry = carriedEntry({ tick: tick(100), standing: "SE", boss: { hp: 1313, defence: 250 }, voids: [{ tile: onSpawn, placed: tick(97) }] }, fullFightConfig(seed(1)));
    const expected: readonly LingeringVoid[] = [{ tile: tile(5, 1), sincePlaced: span(3), period: span(2), damage: { min: 6, max: 7 } }];
    expect(entry.kind === "carried" ? entry.voids : []).toEqual(expected);
    const { region, tickTo } = carriedP4("SE", [{ tile: onSpawn, placed: tick(97) }]);
    tickTo(8);
    expect(region.rows("p4").flatMap((row) => row.events.flatMap((event) => (event.kind === "void-hit" ? [[event.at, event.tile.x, event.tile.y]] : [])))).toEqual([
      [1, 5, 1], [3, 5, 1], [5, 5, 1], [7, 5, 1],
    ]);
  });
});
