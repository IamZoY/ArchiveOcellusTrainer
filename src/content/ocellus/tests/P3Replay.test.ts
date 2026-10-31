import { at } from "../fight/geometry";
import type { FightLog } from "../js/OcellusTimings";
import { P3_REPLAYS } from "../full/p3/replays";
import type { P3Row } from "../full/p3/types";
import { S, startP3 } from "./p3run";

const U = S + 53;
type Run = ReturnType<typeof startP3>;

/** Each logged kind's ticks in the run, up to the last tick the log lists for it. */
function replayed(rows: readonly P3Row[], log: FightLog): Readonly<Record<string, readonly number[]>> {
  const table: Record<string, readonly number[]> = {};
  for (const [kind, replay] of Object.entries(P3_REPLAYS)) {
    if (replay.kind !== "log" || replay.log !== log) continue;
    const last = Math.max(...replay.ticks);
    table[kind] = rows.flatMap((row) =>
      row.events.flatMap((event) => {
        const matches = event.kind === "hit-landed" ? event.cause.kind === kind : event.kind === kind;
        return matches && row.tick <= last ? [row.tick] : [];
      }),
    );
  }
  return table;
}

function logged(log: FightLog): Readonly<Record<string, readonly number[]>> {
  const table: Record<string, readonly number[]> = {};
  for (const [kind, replay] of Object.entries(P3_REPLAYS)) if (replay.kind === "log" && replay.log === log) table[kind] = replay.ticks;
  return table;
}

/** Through Untether on the tiles the plan names, ending each tick under his 3x3 or one tile north of it. */
function holdUntether(f: Run, plan: (t: number) => "under" | "out", from: number, until: number): void {
  f.tickTo(U + from);
  const sw = f.live().boss.tile;
  for (let t = U + from; t <= U + until; t++) {
    f.player().hop(plan(t - U) === "under" ? at(sw.x + 1, sw.z + 1) : at(sw.x + 1, sw.z + 3));
    f.tickTo(t + 1);
  }
}

describe("phase 3's replay rows match the fight logs at the phase marks", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  test("L1: the first quadrant falls after Untether, and the second opens with a panic, the spin and Insolence", () => {
    const f = startP3({ seed: 1 });
    close = f.close;
    f.tickTo(U - 1, f.stayInReach);
    // L1's raiders took the slam outside his 3x3 at U+29; his HP was at the floor by then.
    const plan = (t: number) => (t <= 11 ? "under" : "out");
    holdUntether(f, plan, 1, 10);
    f.bossAt(75);
    holdUntether(f, plan, 11, 30);
    f.tickTo(U + 33);
    f.stepOff();
    // He lands at +107 with nobody in his quadrant to chase, so his first move is the panic.
    f.tickTo(107);
    f.stepOff();
    f.tickTo(111);
    f.tickTo(185, f.stayInReach);
    expect(replayed(f.rows(), "L1")).toEqual(logged("L1"));
  });

  test("a quadrant that falls after Untether drops the rift due 3 after the slam; the next come 3 into the new quadrant and every 48", () => {
    const f = startP3({ seed: 1 });
    close = f.close;
    f.tickTo(U - 1, f.stayInReach);
    const plan = (t: number) => (t <= 11 ? "under" : "out");
    holdUntether(f, plan, 1, 10);
    f.bossAt(75);
    holdUntether(f, plan, 11, 30);
    f.tickTo(U + 33);
    f.stepOff();
    f.tickTo(107);
    f.stepOff();
    f.tickTo(160, f.stayInReach);
    const ticks = (kind: string) => f.rows().flatMap((row) => (row.events.some((event) => event.kind === kind) ? [row.tick] : []));
    const opened = ticks("segment-started")[1];
    expect(ticks("collapse-started")).toEqual([U + 31]);
    expect(ticks("rift-spawned")).toEqual([opened + 3, opened + 3 + 48]);
  });

  test("L6: the vine after the first spin, the aftershock under him, and the next quadrant's rift", () => {
    const f = startP3({ seed: 1 });
    close = f.close;
    f.tickTo(U - 1, f.stayInReach);
    // L6's raiders under him at the end of U+29 took the aftershock; the quadrant stood.
    holdUntether(f, () => "under", 1, 31);
    f.tickTo(167, f.stayInReach);
    f.bossAt(75);
    f.tickTo(170);
    f.stepOff();
    f.tickTo(190);
    expect(replayed(f.rows(), "L6")).toEqual(logged("L6"));
  });
});
