import { Collision, Settings, TrainerInstance, Viewport } from "osrs-sdk";
import { QUADRANTS, at, quadrantOf, quadrantTiles, toSdk } from "../fight/geometry";
import type { Quadrant } from "../fight/geometry";
import { FightPlayer } from "../fight/units";
import type { FightRegion } from "../full/prefix";
import { fullFightStaged } from "../full/prefix";
import { quadrantFrame } from "../full/fall";
import { OCELLUS_P4 } from "../js/OcellusTimings";
import { tile } from "../../../sim/brands";
import { toRoom } from "../../../sim/frame";

let close: (() => void) | null = null;
afterEach(() => {
  close?.();
  close = null;
});

function fullFight(): FightRegion {
  Settings.readFromStorage();
  const region = fullFightStaged(
    { seed: 1, party: 1, startPhase: 3, hazardTiles: false, videoMarkers: false, prayerGuide: false, mechanicsGuide: false, skipMarkers: false, patternMarkers: false, soloVine: true, invincible: true, defenceDrained: false },
    () => undefined,
  );
  const trainer = new TrainerInstance(region, { force2d: true });
  trainer.mount(document.createElement("canvas"), document.createElement("div"));
  region.world.getReadyTimer = 0;
  Viewport.viewport.resize(800, 600);
  close = () => trainer.dispose();
  return region;
}

function you(region: FightRegion): FightPlayer {
  const first = region.players[0];
  if (!(first instanceof FightPlayer)) throw new Error("no player");
  return first;
}

function standingOf(region: FightRegion): Quadrant {
  const left = QUADRANTS.filter((quadrant) => !region.floorState().destroyed.includes(quadrant));
  const only = left[0];
  if (only === undefined || left.length !== 1) throw new Error(`expected one standing quadrant, saw ${left.join(",")}`);
  return only;
}

function platformRooms(standing: Quadrant): Set<string> {
  const frame = quadrantFrame(standing);
  const floor = OCELLUS_P4.geometry.platform.value.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "#" ? [tile(x, y)] : [])));
  return new Set(floor.map((at) => {
    const room = toRoom(frame, at);
    return `${room.x},${room.y}`;
  }));
}

function blocked(region: FightRegion, x: number, y: number): boolean {
  return Collision.collideableEntitiesAtPoint(region, x, y, 1).length > 0;
}

/** The axis stone is not a quadrant, so a player standing on it survives the fall. */
function ontoStone(region: FightRegion): number {
  let moved = false;
  for (let step = 0; step < 2500; step++) {
    region.world.tickWorld();
    if (region.floorState().destroyed.length === 3) return step + 1;
    if (region.current !== "p3") continue;
    const mounted = region.p3.mounted;
    if (!mounted) throw new Error("phase 3 is not mounted");
    const first = region.players[0];
    if (!moved && first instanceof FightPlayer) {
      first.hop(at(-4, 0));
      moved = true;
    }
    mounted.boss.currentStats.hitpoint = Math.min(mounted.boss.currentStats.hitpoint, mounted.script.hpFloor(mounted.boss.stats.hitpoint));
  }
  throw new Error("the third fall never came");
}

function leaveCrumbling(region: FightRegion): void {
  const first = region.players[0];
  if (!(first instanceof FightPlayer)) return;
  const here = quadrantOf(first.arenaTile());
  const fallen = region.floorState().destroyed;
  const next = QUADRANTS.find((quadrant) => quadrant !== here && !fallen.includes(quadrant));
  if (!next) return;
  const floor = quadrantTiles(next).find((tile) => region.p3.mounted?.arena.isWalkable(tile));
  if (floor) first.hop(floor);
}

function fallFromFloor(region: FightRegion): string {
  let before = "";
  for (let step = 0; step < 2500; step++) {
    const first = region.players[0];
    if (first instanceof FightPlayer) before = `${first.location.x},${first.location.y}`;
    region.world.tickWorld();
    if (region.floorState().destroyed.length === 3) return before;
    if (region.current !== "p3") continue;
    const mounted = region.p3.mounted;
    if (!mounted) throw new Error("phase 3 is not mounted");
    mounted.boss.currentStats.hitpoint = Math.min(mounted.boss.currentStats.hitpoint, mounted.script.hpFloor(mounted.boss.stats.hitpoint));
    const crumbling = region.floorState().crumbling;
    if (crumbling.length > 0 && quadrantOf(you(region).arenaTile()) === crumbling[0]) leaveCrumbling(region);
  }
  throw new Error("the third fall never came");
}

describe("phase 4's floor in the full room", () => {
  test("a player on a crossing stone is on the last quadrant's floor, and a walk off it stays there", () => {
    const region = fullFight();
    ontoStone(region);
    const platform = platformRooms(standingOf(region));
    const stone = toSdk(at(-4, 0));
    const player = you(region);
    player.moveTo(0, 0);
    for (let tick = 0; tick < 40; tick++) region.world.tickWorld();
    const landed = `${player.location.x},${player.location.y}`;
    expect({
      phase: region.current,
      stoneBlocked: blocked(region, stone.x, stone.y),
      outsideBlocked: blocked(region, 0, 0),
      onFloor: platform.has(landed),
    }).toEqual({ phase: "p4", stoneBlocked: true, outsideBlocked: true, onFloor: true });
  });

  test("guard: a player already on the last floor keeps that tile", () => {
    const region = fullFight();
    const before = fallFromFloor(region);
    const platform = platformRooms(standingOf(region));
    const player = you(region);
    expect({
      beforeOnFloor: platform.has(before),
      stayed: `${player.location.x},${player.location.y}` === before,
    }).toEqual({ beforeOnFloor: true, stayed: true });
  });

  test("no room tile outside the platform is walkable after the fall", () => {
    const region = fullFight();
    ontoStone(region);
    const platform = platformRooms(standingOf(region));
    const open: string[] = [];
    let openPlatform = 0;
    for (let x = 0; x < region.width; x++) {
      for (let y = 0; y < region.height; y++) {
        const key = `${x},${y}`;
        const walkable = !blocked(region, x, y);
        if (platform.has(key)) {
          if (walkable) openPlatform += 1;
        } else if (walkable) open.push(key);
      }
    }
    expect({ open, openPlatform }).toEqual({ open: [], openPlatform: platform.size });
  });
});
