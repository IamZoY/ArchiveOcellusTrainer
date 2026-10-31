import { describe, expect, it } from "vitest";
import { queueTile, walkStep } from "./RemotePlayer";
import type { WireTile } from "./protocol";

const at = (x: number, y: number): WireTile => ({ x, y });

/** Walks a route to its end the way the engine does, one step a tick, and reports what the figure covered. */
function walked(route: readonly WireTile[], from: WireTile): readonly number[] {
  const hops: number[] = [];
  let here = from;
  let left = route;
  for (let tick = 0; tick < 50; tick++) {
    const step = walkStep(left, here);
    left = step.route;
    if (step.to.x === here.x && step.to.y === here.y) break;
    const reach = step.running ? 2 : 1;
    const dx = Math.sign(step.to.x - here.x);
    const dy = Math.sign(step.to.y - here.y);
    const hop = Math.min(reach, Math.max(Math.abs(step.to.x - here.x), Math.abs(step.to.y - here.y)));
    here = { x: here.x + dx * hop, y: here.y + dy * hop };
    hops.push(hop);
  }
  return hops;
}

describe("queueing what a friend reports", () => {
  it("keeps every tile they stood on, so the figure walks their route rather than cutting the corner", () => {
    let queued = queueTile([], at(10, 10), at(11, 10));
    queued = queueTile(queued.route, at(10, 10), at(12, 10));
    queued = queueTile(queued.route, at(10, 10), at(12, 11));
    expect(queued.route).toEqual([at(11, 10), at(12, 10), at(12, 11)]);
    expect(queued.place).toBe(false);
  });

  it("says nothing twice: a report from a player who has not moved leaves the route alone", () => {
    const first = queueTile([], at(10, 10), at(10, 10));
    expect(first.route).toEqual([]);
    const moved = queueTile([], at(10, 10), at(11, 10));
    expect(queueTile(moved.route, at(10, 10), at(11, 10)).route).toEqual(moved.route);
  });

  it("gives up on walking when the next tile is further than a run could reach, which is a fall or a teleport", () => {
    expect(queueTile([], at(10, 10), at(10, 13)).place).toBe(false);
    expect(queueTile([], at(10, 10), at(10, 14)).place).toBe(true);
  });

  it("gives up when the route has grown past catching up, so a late burst places the figure instead", () => {
    // A ring around the figure: every tile is within a step or two of it, so only the length of the route decides.
    const ring = [at(11, 10), at(12, 10), at(12, 11), at(11, 11), at(10, 11), at(10, 12)];
    let queued: ReturnType<typeof queueTile> = { route: [], place: false };
    for (const tile of ring) {
      queued = queueTile(queued.route, at(10, 10), tile);
      if (queued.route.length < ring.length) expect(queued.place).toBe(false);
    }
    expect(queued.place).toBe(true);
  });
});

describe("walking the route", () => {
  it("takes one tile a tick while it is keeping up, which is a walk", () => {
    expect(walked([at(11, 10), at(12, 10), at(13, 10)], at(10, 10))).toEqual([1, 1, 1]);
  });

  it("runs while it is behind and settles back to a walk once it has caught up", () => {
    const step = walkStep([at(11, 10), at(12, 10)], at(10, 10));
    expect(step).toMatchObject({ to: at(11, 10), running: true });
    expect(walkStep([at(11, 10)], at(10, 10))).toMatchObject({ to: at(11, 10), running: false });
  });

  it("runs to a tile two away, because its owner ran to reach it in one tick", () => {
    expect(walkStep([at(12, 10)], at(10, 10))).toMatchObject({ to: at(12, 10), running: true });
  });

  it("drops the tiles already underfoot rather than standing on them again", () => {
    const step = walkStep([at(10, 10), at(10, 10), at(11, 10)], at(10, 10));
    expect(step.route).toEqual([at(11, 10)]);
    expect(step.to).toEqual(at(11, 10));
  });

  it("stands still with nothing queued, and asks for no move at all", () => {
    expect(walkStep([], at(10, 10))).toEqual({ route: [], to: at(10, 10), running: false });
  });

  it("never hops: a whole route is covered one or two tiles at a time, however it arrived", () => {
    const route = [at(11, 10), at(12, 10), at(12, 11), at(12, 12), at(11, 12)];
    const hops = walked(route, at(10, 10));
    expect(hops.every((hop) => hop === 1 || hop === 2)).toBe(true);
    expect(hops.reduce((all, hop) => all + hop, 0)).toBe(5);
  });
});
