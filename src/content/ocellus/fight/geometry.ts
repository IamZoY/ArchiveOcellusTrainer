/**
 * Arena geometry for the full fight.
 *
 * Arena tiles are offsets from the room's middle, (x east, z north), the frame the RSProx
 * analysis uses (docs/rsprox-analysis/guthixian_archive/ocellus_plan.md). The SDK grid runs
 * x east and y SOUTH, and anchors a unit on its south-west tile, so a 3x3 whose arena
 * south-west tile is (x, z) sits at SDK (x + C, C - z) and covers SDK y from C - z - 2 to C - z.
 *
 * The room is an octagon: |x| <= 12, |z| <= 12, |x| + |z| <= 16. That gives 85 tiles a quadrant
 * (the recording counts 84), 40 open tiles in the middle's two blast rings and 37 at a corner,
 * matching the recording's 40 and 37.
 */

export type ATile = Readonly<{ x: number; z: number }>;
export type SdkTile = Readonly<{ x: number; y: number }>;

export const C = 14;
export const GRID = 2 * C + 1;
export const ROOM_HALF = 12;
export const ROOM_DIAGONAL = 16;

export const at = (x: number, z: number): ATile => ({ x, z });
export const toSdk = (a: ATile): SdkTile => ({ x: a.x + C, y: C - a.z });
export const fromSdk = (s: Readonly<{ x: number; y: number }>): ATile => ({ x: s.x - C, z: C - s.y });
export const key = (a: ATile): string => `${a.x},${a.z}`;
export const same = (a: ATile, b: ATile): boolean => a.x === b.x && a.z === b.z;

export function inRoom(a: ATile): boolean {
  return Math.abs(a.x) <= ROOM_HALF && Math.abs(a.z) <= ROOM_HALF && Math.abs(a.x) + Math.abs(a.z) <= ROOM_DIAGONAL;
}

export function isCentre(a: ATile): boolean {
  return Math.abs(a.x) <= 1 && Math.abs(a.z) <= 1;
}

/** The "+": the three-wide strips along both axes, outside the middle 3x3. */
export function isArm(a: ATile): boolean {
  return inRoom(a) && !isCentre(a) && (Math.abs(a.x) <= 1 || Math.abs(a.z) <= 1);
}

export type Quadrant = "NE" | "SE" | "SW" | "NW";
/** Clockwise from north-east, the order phase 2's rounds advance in. */
export const QUADRANTS: readonly Quadrant[] = ["NE", "SE", "SW", "NW"];
export const QUADRANT_SIGN: Readonly<Record<Quadrant, Readonly<{ sx: number; sz: number }>>> = {
  NE: { sx: 1, sz: 1 },
  SE: { sx: 1, sz: -1 },
  SW: { sx: -1, sz: -1 },
  NW: { sx: -1, sz: 1 },
};

export function clockwise(q: Quadrant, steps = 1): Quadrant {
  const index = QUADRANTS.indexOf(q);
  return QUADRANTS[(((index + steps) % 4) + 4) % 4];
}

/** A tile turned about the middle, a quarter at a time, from one quadrant into the same spot of another. */
export function turnInto(a: ATile, from: Quadrant, to: Quadrant): ATile {
  const turns = (QUADRANTS.indexOf(to) - QUADRANTS.indexOf(from) + 4) % 4;
  let { x, z } = a;
  for (let i = 0; i < turns; i++) [x, z] = [z, -x];
  return at(x, z);
}

/** A quadrant is the room past the arms: |x| >= 2 and |z| >= 2. */
export function quadrantOf(a: ATile): Quadrant | null {
  if (!inRoom(a) || Math.abs(a.x) < 2 || Math.abs(a.z) < 2) return null;
  if (a.x > 0) return a.z > 0 ? "NE" : "SE";
  return a.z > 0 ? "NW" : "SW";
}

/** The side of the room a tile leans to, for tiles on the arms too (used to pick a round's quadrant). */
export function sideOf(a: ATile): Quadrant {
  const east = a.x >= 0;
  const north = a.z >= 0;
  if (east) return north ? "NE" : "SE";
  return north ? "NW" : "SW";
}

export function quadrantTiles(q: Quadrant): ATile[] {
  const tiles: ATile[] = [];
  for (let x = -ROOM_HALF; x <= ROOM_HALF; x++) {
    for (let z = -ROOM_HALF; z <= ROOM_HALF; z++) {
      const t = at(x, z);
      if (quadrantOf(t) === q) tiles.push(t);
    }
  }
  return tiles;
}

export function roomTiles(): ATile[] {
  const tiles: ATile[] = [];
  for (let x = -ROOM_HALF; x <= ROOM_HALF; x++) {
    for (let z = -ROOM_HALF; z <= ROOM_HALF; z++) {
      const t = at(x, z);
      if (inRoom(t)) tiles.push(t);
    }
  }
  return tiles;
}

/** Chebyshev distance. */
export function reach(a: ATile, b: ATile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** Footprint of a size-N unit whose south-west tile is sw. */
export type Body = Readonly<{ sw: ATile; size: number }>;

export function covers(body: Body, a: ATile): boolean {
  return a.x >= body.sw.x && a.x < body.sw.x + body.size && a.z >= body.sw.z && a.z < body.sw.z + body.size;
}

/** Chebyshev distance from a tile to the nearest tile of a body (0 when under it). */
export function distanceToBody(body: Body, a: ATile): number {
  const dx = Math.max(body.sw.x - a.x, 0, a.x - (body.sw.x + body.size - 1));
  const dz = Math.max(body.sw.z - a.z, 0, a.z - (body.sw.z + body.size - 1));
  return Math.max(dx, dz);
}

export function bodyCentre(body: Body): Readonly<{ x: number; z: number }> {
  return { x: body.sw.x + (body.size - 1) / 2, z: body.sw.z + (body.size - 1) / 2 };
}

/** Tiles exactly `ring` tiles out from a body. */
export function ringAround(body: Body, ring: number): ATile[] {
  const tiles: ATile[] = [];
  const lo = { x: body.sw.x - ring, z: body.sw.z - ring };
  const hi = { x: body.sw.x + body.size - 1 + ring, z: body.sw.z + body.size - 1 + ring };
  for (let x = lo.x; x <= hi.x; x++) {
    for (let z = lo.z; z <= hi.z; z++) {
      if (x === lo.x || x === hi.x || z === lo.z || z === hi.z) tiles.push(at(x, z));
    }
  }
  return tiles;
}

export function area(from: ATile, to: ATile): ATile[] {
  const tiles: ATile[] = [];
  for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) {
    for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z++) tiles.push(at(x, z));
  }
  return tiles;
}

export class TileSet {
  private readonly byKey = new Map<string, ATile>();

  constructor(tiles: Iterable<ATile> = []) {
    for (const t of tiles) this.byKey.set(key(t), t);
  }

  has(a: ATile): boolean {
    return this.byKey.has(key(a));
  }

  add(a: ATile): void {
    this.byKey.set(key(a), a);
  }

  delete(a: ATile): void {
    this.byKey.delete(key(a));
  }

  get size(): number {
    return this.byKey.size;
  }

  tiles(): ATile[] {
    return [...this.byKey.values()];
  }
}

/** Phase 1's corner stops (south-west tiles of his 3x3) and the middle. */
export const CORNERS: Readonly<Record<Quadrant, ATile>> = {
  NE: at(5, 5),
  SE: at(5, -7),
  SW: at(-7, -7),
  NW: at(-7, 5),
};
export const MIDDLE: ATile = at(-1, -1);

/** Phase 3 stepping stones: 4, 7 and 10 tiles out on each arm. */
export type Arm = "N" | "E" | "S" | "W";
export const ARMS: readonly Arm[] = ["N", "E", "S", "W"];
export const ARM_DIR: Readonly<Record<Arm, Readonly<{ dx: number; dz: number }>>> = {
  N: { dx: 0, dz: 1 },
  E: { dx: 1, dz: 0 },
  S: { dx: 0, dz: -1 },
  W: { dx: -1, dz: 0 },
};
export const STONE_STEPS = [4, 7, 10] as const;

export function stonesOf(arm: Arm): ATile[] {
  const { dx, dz } = ARM_DIR[arm];
  return STONE_STEPS.map((n) => at(dx * n, dz * n));
}

/** The arm between two clockwise-adjacent quadrants. */
export function armBetween(a: Quadrant, b: Quadrant): Arm | null {
  const pair = new Set([a, b]);
  if (pair.has("NE") && pair.has("SE")) return "E";
  if (pair.has("SE") && pair.has("SW")) return "S";
  if (pair.has("SW") && pair.has("NW")) return "W";
  if (pair.has("NW") && pair.has("NE")) return "N";
  return null;
}

/** The two arms bordering a quadrant, in clockwise order (the first is anticlockwise of it). */
export function armsOf(q: Quadrant): readonly [Arm, Arm] {
  switch (q) {
    case "NE":
      return ["N", "E"];
    case "SE":
      return ["E", "S"];
    case "SW":
      return ["S", "W"];
    case "NW":
      return ["W", "N"];
    default: {
      const unhandled: never = q;
      return unhandled;
    }
  }
}

/** Censers at the quadrants' outer corners, on the diagonal walls. */
export const CENSERS: Readonly<Record<Quadrant, Readonly<{ tile: ATile; god: "bandos" | "saradomin" | "armadyl" | "zaros" }>>> = {
  NE: { tile: at(9, 9), god: "bandos" },
  SE: { tile: at(9, -9), god: "saradomin" },
  SW: { tile: at(-9, -9), god: "armadyl" },
  NW: { tile: at(-9, 9), god: "zaros" },
};

export function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** Bresenham-style line of tiles from a (exclusive) to b (inclusive). */
export function lineTiles(from: ATile, to: ATile): ATile[] {
  const tiles: ATile[] = [];
  let x = from.x;
  let z = from.z;
  const dx = Math.abs(to.x - from.x);
  const dz = Math.abs(to.z - from.z);
  const sx = sign(to.x - from.x);
  const sz = sign(to.z - from.z);
  let err = dx - dz;
  while (x !== to.x || z !== to.z) {
    const e2 = 2 * err;
    if (e2 > -dz) {
      err -= dz;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      z += sz;
    }
    tiles.push(at(x, z));
  }
  return tiles;
}

/** The tile nearest a body's centre. */
export function bodyCentreTile(body: Body): ATile {
  const c = bodyCentre(body);
  return at(Math.round(c.x), Math.round(c.z));
}

/** The tiles strictly between two tiles on a straight line: a void siphon's heal flare is blocked by a player on one. */
export function lineBetween(a: ATile, b: ATile): ATile[] {
  const tiles: ATile[] = [];
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z));
  for (let i = 1; i < steps; i++) tiles.push(at(Math.round(a.x + ((b.x - a.x) * i) / steps), Math.round(a.z + ((b.z - a.z) * i) / steps)));
  return tiles;
}
