import { at } from "../fight/geometry";
import { startP1 } from "./p1run";

type Run = ReturnType<typeof startP1>;

function volleys(f: Run): (readonly [number, string])[] {
  return f.ofKind("volley").flatMap(([tick, event]) => (event.kind === "volley" ? [[tick, event.element] as const] : []));
}

function hits(f: Run, kind: string): (readonly [number, number, number, string | null])[] {
  return f.events().flatMap(([tick, event]) =>
    event.kind === "hit-landed" && event.cause.kind === kind ? [[tick, event.receipt.applied, event.receipt.afterHp, event.receipt.prayer] as const] : [],
  );
}

function healed(f: Run): (readonly [number, string, number, string])[] {
  return f.events().flatMap(([tick, event]) => (event.kind === "healed" ? [[tick, event.target, event.amount, event.cause.kind] as const] : []));
}

function prayMagic(f: Run): void {
  const prayer = f.player().prayerController.findPrayerByName("Protect from Magic");
  if (!prayer) throw new Error("the player has no Protect from Magic");
  prayer.toggle(f.player());
}

describe("phase 1 opens on the engine", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  test("the shout and the challenge open the fight, and the hood comes off on the next tick", () => {
    const f = startP1();
    close = f.close;
    f.tickTo(1);
    const chat = f.looks("chat").map(([tick, look]) => [tick, look.text]);
    const said = f.events().flatMap(([tick, event]) => (event.kind === "boss-changed" && event.change.kind === "said" ? [[tick, event.change.text]] : []));
    expect({ chat, said, revealed: f.ofKind("revealed").map(([tick]) => tick), form: f.live().boss.form, tile: f.bossAt(), here: f.here() }).toEqual({
      chat: [[0, "Challenge started: Ocellus."]],
      said: [[0, "Now... ascension..."]],
      revealed: [1],
      form: "p1",
      tile: at(-1, -4),
      here: at(0, -9),
    });
  });
});

describe("phase 1's first walk", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  test("seed 1 opens on water, steps toward the north-east on the volley's tick, and the far shot lands 4 ticks later", () => {
    const f = startP1({ practice: false });
    close = f.close;
    const path: (readonly [number, ReturnType<Run["bossAt"]>])[] = [];
    for (let tick = 0; tick <= 8; tick++) {
      f.tickTo(tick);
      path.push([tick, f.bossAt()]);
    }
    expect({ volleys: volleys(f), hits: hits(f, "volley"), path, here: f.here(), overhead: f.live().boss.overhead }).toEqual({
      volleys: [[4, "water"]],
      hits: [[8, 21, 78, null]],
      path: [
        [0, at(-1, -4)],
        [1, at(-1, -4)],
        [2, at(-1, -4)],
        [3, at(-1, -4)],
        [4, at(0, -3)],
        [5, at(1, -2)],
        [6, at(2, -1)],
        [7, at(3, 0)],
        [8, at(4, 1)],
      ],
      here: at(0, -9),
      overhead: "protect-melee",
    });
  });

  test("the same water volley is 0 under Protect from Magic, and the fire volley after it is not", () => {
    const f = startP1({ practice: false });
    close = f.close;
    prayMagic(f);
    f.tickTo(13);
    expect(hits(f, "volley")).toEqual([
      [8, 0, 99, "magic"],
      [13, 7, 92, "magic"],
    ]);
  });

  test("standing within three tiles of his body makes that first shot the near one, and it lands 3 ticks later", () => {
    const f = startP1({ practice: false });
    close = f.close;
    f.tickTo(1);
    f.player().hop(at(0, -5));
    f.tickTo(7);
    const shot = f.looks("projectile")[0];
    if (!shot) throw new Error("the first volley drew no shot");
    expect({ near: shot[1].near, flight: shot[1].flight, hits: hits(f, "volley"), here: f.here() }).toEqual({
      near: true,
      flight: 3,
      hits: [[7, 4, 95, null]],
      here: at(0, -5),
    });
  });
  test("4 tiles off his body is far: the shot flies 4 ticks, as within 4 of his middle tile is the 3-tick shot", () => {
    const f = startP1({ practice: false });
    close = f.close;
    f.tickTo(1);
    f.player().hop(at(0, -7));
    f.tickTo(8);
    const shot = f.looks("projectile")[0];
    if (!shot) throw new Error("the first volley drew no shot");
    expect({ near: shot[1].near, flight: shot[1].flight, landed: hits(f, "volley").map(([tick]) => tick) }).toEqual({ near: false, flight: 4, landed: [8] });
  });
});

describe("phase 1's corners", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  test("a nine-tile corner is charged the tick after the next volley, and the blast is 19 ticks after the charge", () => {
    const f = startP1();
    close = f.close;
    f.tickTo(73);
    const arrived = f.ofKind("arrived").flatMap(([tick, event]) => (event.kind === "arrived" ? [[tick, event.corner] as const] : []));
    const charged = f.ofKind("charged").flatMap(([tick, event]) => (event.kind === "charged" ? [[tick, event.corner] as const] : []));
    const said = f.events().flatMap(([tick, event]) => (event.kind === "boss-changed" && event.change.kind === "said" && tick > 0 ? [[tick, event.change.text] as const] : []));
    expect({
      arrived,
      charged,
      cracks: f.ofKind("cracks").map(([tick]) => tick),
      exploded: f.ofKind("exploded").map(([tick]) => tick),
      blasted: f.ofKind("blasted").map(([tick]) => tick),
      volleyTicks: volleys(f).map(([tick]) => tick),
      said,
    }).toEqual({
      arrived: [
        [14, "NE"],
        [46, "NW"],
      ],
      charged: [
        [15, "NE"],
        [52, "NW"],
      ],
      cracks: [15, 17, 19, 21, 23, 25, 27, 52, 54, 56, 58, 60, 62, 64],
      exploded: [33, 70],
      blasted: [34, 71],
      volleyTicks: [4, 9, 36, 41, 46, 73],
      said: [
        [30, "You... fail..."],
        [67, "You... fail..."],
      ],
    });
  });

  test("every crack that closes chips you 3 to 5; standing on it also heals you and does not fill the meter", () => {
    const f = startP1({ practice: false });
    close = f.close;
    f.tickTo(15);
    const crack = f.looks("cracks")[0]?.[1].tiles[0];
    if (!crack) throw new Error("the first line has no tile");
    f.player().hop(crack);
    f.tickTo(22);
    expect({
      crack,
      healed: healed(f),
      hp: f.player().currentStats.hitpoint,
      boss: f.live().boss.currentStats.hitpoint,
      meter: f.live().script.meter,
    }).toEqual({
      crack: at(5, 4),
      healed: [
        [20, "player", 3, "block"],
        [22, "boss", 8, "line"],
      ],
      hp: 66,
      boss: 2500,
      meter: 8,
    });
  });

  test("blocking after a crack you left open pays back both chips: two rolls of 3 to 5", () => {
    const f = startP1({ practice: false });
    close = f.close;
    f.tickTo(17);
    const second = f.looks("cracks")[1]?.[1].tiles[0];
    if (!second) throw new Error("the second line has no tile");
    f.player().hop(second);
    f.tickTo(22);
    // Ten raid logs: a block owed two chips healed mostly 7 to 10.
    expect({ chips: hits(f, "crack").map(([tick, applied]) => [tick, applied]), healed: healed(f) }).toEqual({
      chips: [
        [20, 5],
        [22, 3],
      ],
      healed: [
        [20, "boss", 8, "line"],
        [22, "player", 8, "block"],
      ],
    });
  });

  test("the corner blast hits anyone within 2 of his body on the blast tick", () => {
    const f = startP1({ practice: false });
    close = f.close;
    f.tickTo(30);
    f.player().hop(at(5, 5));
    f.tickTo(34);
    expect(hits(f, "blast")).toEqual([[34, 33, 8, null]]);
  });
});

describe("phase 1's health thresholds", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  test("one hitpoint above 66% is still the walk", () => {
    const f = startP1();
    close = f.close;
    f.tickTo(1);
    const max = f.live().boss.stats.hitpoint;
    f.live().boss.currentStats.hitpoint = Math.floor(max * 0.66) + 1;
    f.tickTo(8);
    expect({ max, line: Math.floor(max * 0.66) + 1, middle: f.ofKind("middle").map(([tick]) => tick), volley: volleys(f).map(([tick]) => tick) }).toEqual({
      max: 2500,
      line: 1651,
      middle: [],
      volley: [4],
    });
  });

  test("66% on the first volley sends him to the middle, and the eight beat cracks left open charge a three-shot strike", () => {
    const f = startP1();
    close = f.close;
    prayMagic(f);
    f.tickTo(1);
    f.live().boss.currentStats.hitpoint = 1650;
    const tiles: (readonly [number, ReturnType<Run["bossAt"]>, boolean])[] = [];
    for (const tick of [4, 5, 8]) {
      f.tickTo(tick);
      tiles.push([tick, f.bossAt(), f.live().boss.hidden]);
    }
    f.tickTo(53);
    const said = f.events().flatMap(([tick, event]) => (event.kind === "boss-changed" && event.change.kind === "said" && tick > 0 ? [[tick, event.change.text]] : []));
    expect({
      tiles,
      middle: f.ofKind("middle").map(([tick]) => tick),
      strike: f.ofKind("strike").map(([tick, event]) => (event.kind === "strike" ? [tick, event.shots] : [])),
      said,
      hits: hits(f, "strike"),
      volley: volleys(f).map(([tick]) => tick),
    }).toEqual({
      tiles: [
        [4, at(0, -3), false],
        [5, at(0, -3), true],
        [8, at(-1, -1), false],
      ],
      middle: [4],
      // Eight unblocked cracks, 8 each, fill 64 of meter: two more shots, landing the tick after the first.
      strike: [[44, 3]],
      said: [[44, "Eradicate..."]],
      hits: [
        [47, 18, 81, "magic"],
        [48, 18, 63, "magic"],
        [48, 19, 44, "magic"],
      ],
      // Fight logs L1, L3 to L8: his first volley 9 ticks after "Death... awaits...", 11 of 11.
      volley: [53],
    });
  });

  test("one hitpoint above a quarter, on the way out of the middle, is the volley", () => {
    const f = startP1();
    close = f.close;
    f.tickTo(1);
    f.live().boss.currentStats.hitpoint = 1650;
    f.tickTo(52);
    f.live().boss.currentStats.hitpoint = 626;
    f.tickTo(53);
    expect({ middle: f.ofKind("middle").map(([tick]) => tick), volley: volleys(f).map(([tick]) => tick) }).toEqual({
      middle: [4],
      volley: [53],
    });
  });

  test("a quarter health on the way out of the middle starts the middle again instead of the volley", () => {
    const f = startP1();
    close = f.close;
    f.tickTo(1);
    f.live().boss.currentStats.hitpoint = 1650;
    f.tickTo(52);
    f.live().boss.currentStats.hitpoint = 625;
    f.tickTo(53);
    expect({ middle: f.ofKind("middle").map(([tick]) => tick), volley: volleys(f).map(([tick]) => tick) }).toEqual({
      middle: [4, 53],
      volley: [],
    });
  });
});

describe("phase 1 ends", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  test("hitting 0 off the middle teleports him 2 ticks on, lands him 3 after, and phase 2's tick 0 is 14 ticks after the fall", () => {
    const f = startP1();
    close = f.close;
    f.tickTo(2);
    f.live().boss.currentStats.hitpoint = 0;
    const frames: (readonly [number, string])[] = [];
    let fight = 2;
    while (f.region.current === "p1") {
      f.tickOnce();
      fight += 1;
      if (f.region.current !== "p1") break;
      if (fight === 3 || fight === 6 || fight === 7 || fight === 8) frames.push([fight, `${f.bossAt().x},${f.bossAt().z},${f.live().boss.hidden ? "hidden" : "shown"}`]);
    }
    const leaving = f.ofKind("leaving").map(([tick]) => tick);
    const ending = f.ofKind("ending").map(([tick]) => tick);
    f.tickOnce();
    expect({ ending, frames, leaving, next: fight, phase: f.region.current, p2: f.region.p2.mounted?.now() ?? -1 }).toEqual({
      ending: [3],
      frames: [
        [3, "-1,-4,shown"],
        [6, "-1,-4,hidden"],
        [7, "-1,-1,hidden"],
        [8, "-1,-1,shown"],
      ],
      leaving: [16],
      next: 16,
      phase: "p2",
      p2: 0,
    });
  });

  test("hitting 0 already on the middle skips the teleport and phase 2's tick 0 is 10 ticks after the fall", () => {
    const f = startP1();
    close = f.close;
    f.tickTo(2);
    f.live().boss.teleport(at(-1, -1));
    f.live().boss.currentStats.hitpoint = 0;
    const frames: (readonly [number, string])[] = [];
    let fight = 2;
    while (f.region.current === "p1") {
      f.tickOnce();
      fight += 1;
      if (f.region.current !== "p1") break;
      if (fight === 3 || fight === 4 || fight === 6) frames.push([fight, `${f.bossAt().x},${f.bossAt().z},${f.live().boss.hidden ? "hidden" : "shown"}`]);
    }
    f.tickOnce();
    expect({ frames, leaving: f.ofKind("leaving").map(([tick]) => tick), next: fight, phase: f.region.current, p2: f.region.p2.mounted?.now() ?? -1 }).toEqual({
      frames: [
        [3, "-1,-1,shown"],
        [4, "-1,-1,shown"],
        [6, "-1,-1,shown"],
      ],
      leaving: [12],
      next: 12,
      phase: "p2",
      p2: 0,
    });
  });

  test("a lethal volley removes him when the death timer ends, and the dialog is the death line", () => {
    const f = startP1({ practice: false });
    close = f.close;
    // Each closing crack chips 3 to 5 as well, so the volley at 45 is the lethal one.
    f.tickTo(45);
    const fallen = f.player().currentStats.hitpoint;
    f.tickTo(49);
    expect({
      fallen,
      players: f.region.players.length,
      outcome: f.live().script.outcome,
      chat: f.region.chat().filter((line) => line.text.startsWith("Oh dear")),
    }).toEqual({
      fallen: 0,
      players: 0,
      outcome: { kind: "lost", at: 49 },
      chat: [{ text: "Oh dear, you are dead!", colour: "#000000", tick: 49 }],
    });
  });

  test("practice mode refills him to 99 the tick his hitpoints reach 0", () => {
    const f = startP1({ practice: true });
    close = f.close;
    f.tickTo(1);
    f.player().currentStats.hitpoint = 0;
    const emptied = f.player().currentStats.hitpoint;
    f.tickOnce();
    expect({ emptied, hp: f.player().currentStats.hitpoint, outcome: f.live().script.outcome.kind }).toEqual({
      emptied: 0,
      hp: 99,
      outcome: "running",
    });
  });

  test("danger tiles follow the open cracks, and the sidebar switch clears them", () => {
    const f = startP1();
    close = f.close;
    f.tickTo(15);
    const shown = f.live().views.marks().length;
    f.region.setHazardTiles(false);
    const hidden = f.live().views.marks().length;
    f.region.setHazardTiles(true);
    const restored = f.live().views.marks().length;
    expect({ shown, hidden, restored }).toEqual({ shown: 9, hidden: 0, restored: 9 });
  });
});
