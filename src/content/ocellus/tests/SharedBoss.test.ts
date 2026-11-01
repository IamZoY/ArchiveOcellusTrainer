/**
 * One boss, two clients. A hit crosses the room while it is still in the air, and the client that hears about it
 * lands it on the tick it was told to, which is the tick it lands on where it was thrown. That is what makes the
 * party's damage add up to one kill: the boss stands on the same hitpoints on every machine at the end of every
 * tick, so his phases turn over together rather than a tick apart.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Projectile } from "osrs-sdk";
import { startP1 } from "./p1run";
import { BlowBook } from "../../../multiplayer/blows";
import { RemoteCrowd } from "../../../multiplayer/RemotePlayer";
import type { Known } from "../../../multiplayer/RemotePlayer";
import type { Blow, PlayerState } from "../../../multiplayer/protocol";

const FRIEND = "friend";

function reporting(tick: number, blows: readonly Blow[]): PlayerState {
  return { id: FRIEND, tick, tile: { x: 10, y: 10 }, hp: 99, maxHp: 99, prayer: null, dead: false, worn: null, swing: "attack", blows };
}

describe("a boss the whole party wears down", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  function fight() {
    const run = startP1({ seed: 7 });
    close = run.close;
    // Past the hood, the reveal and his opening Protect from Melee, which is where any hit of any style lands.
    run.tickTo(16);
    const boss = run.live().boss;
    const known = new Map<string, Known>([[FRIEND, { name: "Ziad", gear: null, dead: false }]]);
    const crowd = new RemoteCrowd(run.region, { x: 10, y: 10 });
    return { run, boss, known, crowd, at: () => run.region.world.globalTickCounter, hp: () => boss.currentStats.hitpoint };
  }

  it("lands a friend's hit on the tick the room said it would, and not before", () => {
    const { run, known, crowd, at, hp } = fight();
    const before = hp();
    const lands = at() + 3;
    crowd.apply([reporting(at(), [{ seq: 1, landsAt: lands, flight: 3, damage: 40, style: "slash" }])], known);

    run.tickOnce();
    expect(hp()).toBe(before);
    run.tickOnce();
    expect(hp()).toBe(before);
    run.tickOnce();
    expect(at()).toBe(lands);
    expect(hp()).toBe(before - 40);
  });

  it("takes a hit once however many reports repeat it, and takes every one of a burst", () => {
    const { run, known, crowd, at, hp } = fight();
    const before = hp();
    const burst: readonly Blow[] = [
      { seq: 1, landsAt: at() + 1, flight: 1, damage: 10, style: "slash" },
      { seq: 2, landsAt: at() + 1, flight: 1, damage: 20, style: "slash" },
    ];
    crowd.apply([reporting(at(), burst)], known);
    // The same two again, as the next report would carry them, plus one more behind them.
    crowd.apply([reporting(at(), [...burst, { seq: 3, landsAt: at() + 2, flight: 2, damage: 5, style: "range" }])], known);

    run.tickOnce();
    expect(hp()).toBe(before - 30);
    run.tickOnce();
    expect(hp()).toBe(before - 35);
  });

  it("still lands a hit whose news arrived too late, rather than losing the damage", () => {
    const { run, known, crowd, at, hp } = fight();
    const before = hp();
    const late = { seq: 1, landsAt: at() - 5, flight: 2, damage: 25, style: "crush" as const };
    crowd.apply([reporting(at(), [late])], known);

    run.tickOnce();
    expect(hp()).toBe(before - 25);
  });

  it("reports its own hit with the tick it really lands on, which is what a friend is told", () => {
    const { run, boss, at, hp } = fight();
    const book = new BlowBook();
    const you = run.player();
    const before = hp();
    // What the engine itself puts in the air when this player attacks: a hit, a style, and a delay before it lands.
    boss.addProjectile(new Projectile(null, 37, you, boss, "slash", { setDelay: 2 }));

    const said = book.read(boss, you, at());
    expect(said).toEqual([{ seq: 1, landsAt: at() + 2, flight: 2, damage: 37, style: "slash" }]);

    run.tickOnce();
    expect(hp()).toBe(before);
    run.tickOnce();
    // The tick the sender promised is the tick the engine landed it on, so a friend relaying it stays in step.
    expect(at()).toBe(said[0]?.landsAt);
    expect(hp()).toBe(before - 37);

    // Read again and it says the same thing: a hit is written down once, and repeated until it is old news.
    expect(book.read(boss, you, at()).map((blow) => blow.seq)).toEqual([1]);
  });

  it("leaves two clients on the same hitpoints, tick for tick", () => {
    const TICKS = 12;
    const swings = new Set([0, 3, 4, 8]);
    const party = new Map<string, Known>([[FRIEND, { name: "Ziad", gear: null, dead: false }]]);

    // The client throwing the hits, keeping what each of its reports would have carried.
    const reports: (readonly Blow[])[] = [];
    const his: number[] = [];
    const thrower = startP1({ seed: 7 });
    const book = new BlowBook();
    thrower.tickTo(16);
    for (let i = 0; i < TICKS; i++) {
      const boss = thrower.live().boss;
      // What the engine puts in the air when he attacks, at the odd delays real weapons have.
      if (swings.has(i)) boss.addProjectile(new Projectile(null, 20 + i, thrower.player(), boss, "slash", { setDelay: 1 + (i % 3) }));
      reports.push(book.read(boss, thrower.player(), thrower.region.world.globalTickCounter));
      thrower.tickOnce();
      his.push(boss.currentStats.hitpoint);
    }
    thrower.close();

    // The client that only hears about them, one report a tick, as the room hands them over.
    const mine: number[] = [];
    const watcher = startP1({ seed: 7 });
    close = watcher.close;
    const crowd = new RemoteCrowd(watcher.region, { x: 10, y: 10 });
    watcher.tickTo(16);
    for (let i = 0; i < TICKS; i++) {
      crowd.apply([reporting(watcher.region.world.globalTickCounter, reports[i] ?? [])], party);
      watcher.tickOnce();
      mine.push(watcher.live().boss.currentStats.hitpoint);
    }

    expect(mine).toEqual(his);
    // And they are hitpoints that moved, so the two are not merely agreeing about a boss nobody touched.
    expect(his[his.length - 1]).toBeLessThan(his[0] ?? 0);
  });

  it("leaves a friend's relayed hit out of what this client claims as its own", () => {
    const { run, boss, known, crowd, at } = fight();
    const book = new BlowBook();
    crowd.apply([reporting(at(), [{ seq: 1, landsAt: at() + 1, flight: 1, damage: 12, style: "slash" }])], known);
    run.tickOnce();
    expect(book.read(boss, run.player(), at())).toEqual([]);
  });
});
