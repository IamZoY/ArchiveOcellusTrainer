import { at } from "../fight/geometry";
import type { ATile } from "../fight/geometry";
import { startP2 } from "./p2run";

type Run = ReturnType<typeof startP2>;

/** The tick a volley is over the tile d out, counted from the firing tick. */
function reach(d: number, speed: number): number {
  return Math.floor((speed * d - speed) / 30);
}

function tileKey(tile: ATile): string {
  return `${tile.x},${tile.z}`;
}

function volleyAt(f: Run, tick: number) {
  const found = f.ofKind("volley").find(([atTick]) => atTick === tick);
  if (!found || found[1].kind !== "volley") throw new Error(`no volley at ${tick}`);
  return found[1];
}

/** Tiles a volley judges on tick `k` after it fires. */
function judged(lines: readonly (readonly ATile[])[], speed: number, k: number): Set<string> {
  const tiles = new Set<string>();
  for (const line of lines) {
    line.forEach((tile, index) => {
      if (reach(index + 1, speed) === k) tiles.add(tileKey(tile));
    });
  }
  return tiles;
}

describe("phase 2's blade, rounds and hazards", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  test("an opening names the challenge, and the blade wakes at tick 7", () => {
    const f = startP2();
    close = f.close;
    f.tickTo(7);
    const chat = f.looks("chat").map(([tick, look]) => [tick, look.text]);
    expect(chat).toEqual([
      [0, "Challenge started: Ocellus."],
      [7, "The Blade can now be attacked."],
    ]);
  });

  test("the lit volleys, the two crossfires, and no volley once the blade has called enough", () => {
    const f = startP2();
    close = f.close;
    f.tickTo(130);
    const volleys = f.ofKind("volley").map(([tick, event]) => (event.kind === "volley" ? [tick, event.crossfire, event.speed] : []));
    expect(volleys).toEqual([
      [15, false, 6],
      [20, false, 6],
      [25, false, 6],
      [30, false, 6],
      [35, false, 6],
      [40, false, 6],
      [51, true, 5],
      [57, false, 6],
      [62, false, 6],
      [67, false, 6],
      [72, false, 6],
      [77, false, 6],
      [82, false, 6],
      [93, true, 5],
      [99, false, 6],
      [104, false, 6],
      [109, false, 6],
      [114, false, 6],
      [119, false, 6],
    ]);
  });

  test("standing where the first volley has already passed, the next tick does not hit", () => {
    const f = startP2();
    close = f.close;
    f.tickTo(15);
    const lines = volleyAt(f, 15).lines;
    const later = judged(lines, 6, 1);
    const passed = lines.flatMap((line) => (line.length >= 6 && !later.has(tileKey(line[3])) ? [line[3]] : []));
    const tile = passed[0];
    if (tile === undefined) throw new Error("the first volley had no passed tile clear of the next band");
    f.player().hop(tile);
    f.tickOnce();
    expect(f.landed("line", 16)).toEqual([]);
  });

  test("standing where the first volley arrives on the next tick, that tick hits", () => {
    const f = startP2();
    close = f.close;
    f.tickTo(15);
    const lines = volleyAt(f, 15).lines;
    const later = [...judged(lines, 6, 1)];
    const key = later[0];
    if (key === undefined) throw new Error("the first volley never reaches a second band");
    const [x, z] = key.split(",").map(Number);
    if (x === undefined || z === undefined) throw new Error("a volley tile had no coordinates");
    f.player().hop(at(x, z));
    f.tickOnce();
    expect(f.landed("line", 16)).toEqual([16]);
  });

  test("the all-twelve volley hits the tile one south of the east arm", () => {
    const f = startP2();
    close = f.close;
    f.tickTo(50);
    f.player().hop(at(1, -1));
    f.tickOnce();
    // The east arm's column and the south arm's row both cross (1, -1) on the firing tick.
    expect(f.landed("line", 51)).toEqual([51, 51]);
  });

  test("the blade keeps three quarters of the pool", () => {
    const f = startP2({ practice: false });
    close = f.close;
    f.tickTo(8);
    const boss = f.live().boss;
    boss.currentStats.hitpoint = 1;
    f.tickOnce();
    expect(boss.currentStats.hitpoint).toBe(3938);
  });

  test("a player on the cross when it rises is moved into the quadrant they lean toward", () => {
    const f = startP2();
    close = f.close;
    f.tickTo(1);
    f.player().hop(at(1, 0));
    f.tickOnce();
    expect(f.here()).toEqual(at(1, 1));
  });

  test("standing on the safe portal the tick after it opens hops into the next quadrant", () => {
    const f = startP2();
    close = f.close;
    f.tickTo(44);
    const opened = f.ofKind("safe-opened").find(([tick]) => tick === 44);
    if (!opened || opened[1].kind !== "safe-opened") throw new Error("no safe portal at tick 44");
    f.player().hop(opened[1].tile);
    f.tickOnce();
    const escaped = f.ofKind("escaped").find(([tick]) => tick === 45);
    if (!escaped || escaped[1].kind !== "escaped") throw new Error("standing on the safe portal did not hop");
    expect(escaped[1].to.x).toBeLessThan(0);
    expect(escaped[1].to.z).toBeLessThan(0);
    expect(f.here()).toEqual(escaped[1].to);
  });

  test("pools open twice, thirteen tiles each, and not on the last round", () => {
    const f = startP2();
    close = f.close;
    f.tickTo(130);
    const pools = f.ofKind("pools-opened").map(([tick, event]) => (event.kind === "pools-opened" ? [tick, event.count] : []));
    expect(pools).toEqual([
      [39, 13],
      [81, 13],
    ]);
  });

  test("a pool never hurts, and the pools go 6 ticks after they open", () => {
    const f = startP2();
    close = f.close;
    // The sixth wave fires at 40 and is past every tile by 42, so from 43 only a pool could hurt.
    f.tickTo(42);
    const pool = f.looks("ground").find(([tick, look]) => tick === 39 && look.effect === "pools")?.[1].tiles[0];
    if (!pool) throw new Error("no pools opened at 39");
    f.player().hop(pool);
    const hp = f.player().currentStats.hitpoint;
    f.tickTo(46);
    const poolMarks = (tick: number) => f.looks("marks").filter(([t]) => t <= tick).at(-1)?.[1].tiles.filter((mark) => mark.role === "pool").length ?? 0;
    // Ten raid logs: 156 raider-ticks on a pool and no pool hit; the 4270 graphic ends 6 ticks after it opens.
    expect({ hp: f.player().currentStats.hitpoint, onPoolAt44: poolMarks(44), onPoolAt45: poolMarks(45) }).toEqual({ hp, onPoolAt44: 13, onPoolAt45: 0 });
  });

  test("the sword repairs from tick 3 every 3 ticks, and stops before enough", () => {
    const f = startP2();
    close = f.close;
    f.tickTo(130);
    const repairs = f.looks("ground").flatMap(([tick, look]) => (look.effect === "repair" ? [tick] : []));
    const expected: number[] = [];
    for (let tick = 3; tick < 123; tick += 3) expected.push(tick);
    expect(repairs).toEqual(expected);
  });

  test("the blade asks to leave on tick 130, and phase 3's tick 0 is 131", () => {
    const f = startP2();
    close = f.close;
    f.tickTo(130);
    expect(f.ofKind("leaving").map(([tick]) => tick)).toEqual([130]);
    expect(f.region.current).toBe("p3");
    expect(f.region.startOf("p3")).toBe(131);
  });
});
