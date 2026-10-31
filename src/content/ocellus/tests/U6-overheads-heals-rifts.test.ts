import { BladeOfSaeldor } from "osrs-sdk";
import type { Fill } from "../../../../test/paintedTiles";
import { paintedFills } from "../../../../test/paintedTiles";
import type { DrillSelection } from "../js/OcellusTimings";
import type { RiftId } from "../js/P4Types";
import type { At } from "./drill";
import { RING_NORTH, UNDER_BOSS, startDrill } from "./drill";

const TRANSITIONS = { focus: "transition-attacks", specialSelection: "replay-v2" } as const;

const FIRST_ATTACK_ON_SEED_100 = {
  bow: { setup: "ranged", style: "ranged", requested: [54] },
  scythe: { setup: "melee", style: "melee", requested: [31, 7, 5] },
} as const;

type Drill = ReturnType<typeof startDrill>;

const FIRST_RIFT: RiftId = "rift-67-0";
const SECOND_RIFT: RiftId = "rift-67-1";

function riftTile(drill: Drill, rift: RiftId): At {
  const spawned = drill.events("rift-spawned").find((e) => e.rift === rift);
  if (!spawned) throw new Error(`${rift} has not spawned`);
  return spawned.tile;
}

function riftMob(drill: Drill, rift: RiftId) {
  const at = riftTile(drill, rift);
  const mob = [...drill.region.mobs, ...drill.region.newMobs].find((unit) => unit.location.x === at.x && unit.location.y === at.y);
  if (!mob) throw new Error(`no mob stands on ${rift}'s tile (${at.x}, ${at.y})`);
  return mob;
}

const secondRift = (drill: Drill) => riftMob(drill, SECOND_RIFT);

async function attackSecondRift(drill: Drill, special: boolean) {
  drill.tickTo(68);
  drill.player().useSpecialAttack = special;
  await drill.click(riftTile(drill, SECOND_RIFT));
  drill.tickTo(79);
  return [drill.events("rift-hit").map((e) => [e.at, e.damage]), drill.events("rift-destroyed").map((e) => e.at)];
}

type DeflectAttack = Readonly<{
  attack: string;
  selection: DrillSelection;
  seed: number;
  wield: number | null;
  special: boolean;
  from: number;
  to: number;
  judged: readonly unknown[];
  reflected: readonly unknown[];
  playerHp: number;
  bossLost: number;
}>;

function attackIntoDeflect({ selection, seed, wield, special, from, to, judged, reflected, playerHp, bossLost }: DeflectAttack) {
  const drill = startDrill({ seed, selection });
  drill.tickTo(from - 1);
  if (wield !== null) drill.clickInventory(wield);
  drill.player().useSpecialAttack = special;
  drill.player().setAggro(drill.boss());
  drill.tickTo(to);
  const lost = drill.rows().filter((row) => row.tick >= from).reduce((sum, row) => sum + row.bossHp.atBossStep - row.bossHp.atPostTick, 0);
  expect({
    judged: drill.events("player-hit-judged").map((e) => [e.at, e.style, e.outcome, e.requested]),
    reflected: drill.events("deflect-reflected").map((e) => [e.at, e.style, e.receipt]),
    playerHp: drill.row(to).playerAtPostTick.hp,
    bossLost: lost,
  }).toEqual({ judged, reflected, playerHp, bossLost });
  drill.dispose();
}

describe("U6 boss overheads, heals and rifts", () => {
  test.each([
    { target: "the size-1 second rift once", seed: 2, selection: { focus: "rifts", setup: "melee" }, aggroAt: 68, pick: secondRift, swingAt: 71, hits: [35], hpAfter: 9 },
    { target: "the size-1 second rift once more on its next swing", seed: 2, selection: { focus: "rifts", setup: "melee" }, aggroAt: 68, pick: secondRift, swingAt: 76, hits: [9], hpAfter: 0 },
    { target: "the size-3 boss three times", seed: 4, selection: { focus: "rifts", drillStart: "cycle-start", setup: "melee", deflect: "none", hoverMeleeReach: "reachable" }, aggroAt: 12, pick: (drill: Drill) => drill.boss(), swingAt: 13, hits: [4, 12, 8], hpAfter: 1288 },
  ] as const)("guard: one scythe swing hits $target", ({ seed, selection, aggroAt, pick, swingAt, hits, hpAfter }) => {
    const drill = startDrill({ seed, selection });
    drill.tickTo(aggroAt);
    const target = pick(drill);
    drill.player().setAggro(target);
    drill.tickTo(swingAt);
    const queued = target.incomingProjectiles.filter((hit) => hit.from === drill.player()).map((hit) => hit.damage);
    drill.tickTo(swingAt + 2);
    expect([queued, target.currentStats.hitpoint]).toEqual([hits, hpAfter]);
    drill.dispose();
  });

  test.each([
    ["bow", 9, 11, "passed", 54],
    ["bow", 30, 32, "passed", 54],
    ["scythe", 31, 32, "blocked", 0],
    ["scythe", 32, 33, "blocked", 0],
    ["scythe", 33, 34, "passed", 43],
    ["bow", 33, 35, "passed", 54],
    ["bow", 37, 39, "passed", 54],
    ["scythe", 38, 39, "passed", 43],
    ["bow", 38, 40, "passed", 54],
    ["scythe", 39, 40, "passed", 43],
    ["bow", 39, 41, "blocked", 0],
    ["scythe", 59, 60, "passed", 43],
    ["bow", 59, 61, "blocked", 0],
    ["scythe", 61, 62, "passed", 43],
    ["bow", 61, 63, "passed", 54],
    ["scythe", 67, 68, "passed", 43],
    ["bow", 67, 69, "passed", 54],
  ] as const)("guard: Deflect judges a hit by the overhead when it was launched: a %s attack from the ring launched at %i and landing at %i", async (weapon, launchedAt, landsAt, outcome, taken) => {
    const { setup, style, requested } = FIRST_ATTACK_ON_SEED_100[weapon];
    const drill = startDrill({ seed: 100, selection: { focus: "rifts", drillStart: "cycle-start", setup } });
    await drill.click(RING_NORTH);
    drill.tickTo(launchedAt - 1);
    await drill.click(UNDER_BOSS);
    drill.tickTo(landsAt);
    const { atBossStep, atPostTick } = drill.row(landsAt).bossHp;
    expect([drill.events("player-hit-judged").map((e) => [e.at, e.style, e.outcome, e.requested]), atBossStep - atPostTick]).toEqual([
      requested.map((amount) => [landsAt, style, outcome, amount]),
      taken,
    ]);
    drill.dispose();
  });

  test.each([
    {
      attack: "Twisted Bow shots into Deflect Range",
      selection: { focus: "rifts", drillStart: "cycle-start" },
      seed: 4, wield: null, special: false, from: 39, to: 52,
      judged: [[42, "ranged", "blocked", 8], [47, "ranged", "blocked", 44], [52, "ranged", "blocked", 62]],
      reflected: [[47, "ranged", { requested: 4, applied: 4, beforeHp: 99, afterHp: 95, prayer: null }], [52, "ranged", { requested: 6, applied: 6, beforeHp: 95, afterHp: 89, prayer: null }]],
      playerHp: 89,
      bossLost: 0,
    },
    {
      attack: "Ralos throws into Deflect Range",
      selection: { focus: "rifts", drillStart: "cycle-start" },
      seed: 5, wield: 28922, special: false, from: 39, to: 52,
      judged: [[42, "ranged", "blocked", 0], [42, "ranged", "blocked", 0], [48, "ranged", "blocked", 13], [48, "ranged", "blocked", 2]],
      reflected: [[48, "ranged", { requested: 1, applied: 1, beforeHp: 99, afterHp: 98, prayer: null }]],
      playerHp: 98,
      bossLost: 0,
    },
    {
      attack: "a Division into Deflect Range",
      selection: { focus: "rifts", drillStart: "cycle-start" },
      seed: 4, wield: 28922, special: true, from: 39, to: 46,
      judged: [[42, "ranged", "blocked", 2], [42, "ranged", "blocked", 13]],
      reflected: [[42, "ranged", { requested: 1, applied: 1, beforeHp: 99, afterHp: 98, prayer: null }]],
      playerHp: 98,
      bossLost: 0,
    },
    {
      attack: "a scythe swing into Deflect Melee",
      selection: { focus: "rifts", drillStart: "cycle-start", setup: "melee" },
      seed: 4, wield: null, special: false, from: 29, to: 33,
      judged: [[31, "melee", "blocked", 4], [31, "melee", "blocked", 12], [31, "melee", "blocked", 8]],
      reflected: [[31, "melee", { requested: 1, applied: 1, beforeHp: 99, afterHp: 98, prayer: null }]],
      playerHp: 98,
      bossLost: 0,
    },
  ] as const)("Deflect blocks a hit of its style and reflects 10% of it, rounded down, onto the player: $attack", attackIntoDeflect);

  test.each([
    {
      attack: "Twisted Bow shots into Deflect Melee and Soul Split, which do not turn them away",
      selection: { focus: "rifts", drillStart: "cycle-start" },
      seed: 4, wield: null, special: false, from: 30, to: 38,
      judged: [[33, "ranged", "passed", 8], [38, "ranged", "passed", 44]],
      reflected: [],
      playerHp: 99,
      bossLost: 52,
    },
    {
      attack: "Twisted Bow shots into Deflect Range under deflect=block-at-launch",
      selection: { focus: "rifts", drillStart: "cycle-start", deflect: "block-at-launch" },
      seed: 4, wield: null, special: false, from: 39, to: 52,
      judged: [[42, "ranged", "blocked", 8], [47, "ranged", "blocked", 44], [52, "ranged", "blocked", 62]],
      reflected: [],
      playerHp: 99,
      bossLost: 0,
    },
  ] as const)("guard, nothing reflected: $attack", attackIntoDeflect);

  test.each([
    { weapon: "a scythe", selection: { focus: "rifts", drillStart: "cycle-start", setup: "melee" }, standsOn: { x: 5, y: 3 }, judged: [[31, "melee", "blocked"], [31, "melee", "blocked"], [31, "melee", "blocked"]] },
    {
      weapon: "a scythe under hoverMeleeReach=reachable",
      selection: { focus: "rifts", drillStart: "cycle-start", setup: "melee", hoverMeleeReach: "reachable" },
      standsOn: { x: 5, y: 3 },
      judged: [
        [14, "melee", "blocked"], [14, "melee", "blocked"], [14, "melee", "blocked"],
        [19, "melee", "blocked"], [19, "melee", "blocked"], [19, "melee", "blocked"],
        [24, "melee", "blocked"], [24, "melee", "blocked"], [24, "melee", "blocked"],
        [29, "melee", "blocked"], [29, "melee", "blocked"], [29, "melee", "blocked"],
      ],
    },
    { weapon: "a bow", selection: { focus: "rifts", drillStart: "cycle-start" }, standsOn: { x: 5, y: 1 }, judged: [[16, "ranged", "passed"], [21, "ranged", "passed"], [26, "ranged", "passed"], [31, "ranged", "passed"]] },
  ] as const)("melee cannot reach the boss while he hovers, from P4 tick 8 to 29, and ranged can: $weapon on him from tick 12", ({ selection, standsOn, judged }) => {
    const drill = startDrill({ selection });
    drill.tickTo(12);
    drill.player().setAggro(drill.boss());
    drill.tickTo(31);
    expect([drill.row(29).playerAtPostTick.tile, drill.events("player-hit-judged").map((e) => [e.at, e.style, e.outcome])]).toEqual([standsOn, judged]);
    drill.dispose();
  });

  test.each([
    { attack: "the ranged setup's Twisted Bow", seed: 2, setup: "ranged", wield: null, special: false, landed: [[71, 44]], destroyedAt: [72] },
    { attack: "the melee setup's Twisted Bow", seed: 2, setup: "melee", wield: 20997, special: false, landed: [[71, 44]], destroyedAt: [72] },
    { attack: "the ranged setup's Ralos", seed: 2, setup: "ranged", wield: 28922, special: false, landed: [[71, 18], [71, 18], [77, 8], [77, 8]], destroyedAt: [78] },
    { attack: "the melee setup's Ralos", seed: 2, setup: "melee", wield: 28922, special: false, landed: [[71, 15], [71, 15], [77, 14], [77, 14]], destroyedAt: [78] },
    { attack: "a Division special, which rolls", seed: 3, setup: "ranged", wield: 28922, special: true, landed: [[72, 15], [72, 5], [78, 18], [78, 18]], destroyedAt: [79] },
  ] as const)("a standard ranged attack always lands its max hit on a Void Rift: $attack", async ({ seed, setup, wield, special, landed, destroyedAt }) => {
    const drill = startDrill({ seed, selection: { focus: "rifts", setup } });
    if (wield !== null) drill.clickInventory(wield);
    expect(await attackSecondRift(drill, special)).toEqual([landed, destroyedAt]);
    drill.dispose();
  });

  test.each([
    { attack: "the melee setup's scythe, one hit a swing on the size-1 rift", carried: null, landed: [[71, 35], [76, 9]], destroyedAt: [77] },
    { attack: "a Blade of saeldor", carried: () => new BladeOfSaeldor(), landed: [[71, 38], [75, 6]], destroyedAt: [76] },
  ] as const)("a standard melee attack always lands its max hit on a Void Rift: $attack", async ({ carried, landed, destroyedAt }) => {
    const drill = startDrill({ seed: 4, selection: { focus: "rifts", setup: "melee" } });
    if (carried !== null) {
      const weapon = carried();
      drill.player().inventory[0] = weapon;
      drill.clickInventory(weapon.cacheItemId);
    }
    expect(await attackSecondRift(drill, false)).toEqual([landed, destroyedAt]);
    drill.dispose();
  });

  test("Soul Split heals the boss two ticks after each unprotected transition hit, by the damage that hit applied", () => {
    const drill = startDrill({ selection: TRANSITIONS });
    drill.tickTo(68);
    expect(drill.events("boss-healed").map((e) => [e.at, e.cause, e.receipt])).toEqual([
      [39, { kind: "soul-split", ordinal: 0 }, { requested: 49, applied: 49, beforeHp: 1312, afterHp: 1361 }],
      [67, { kind: "soul-split", ordinal: 1 }, { requested: 47, applied: 47, beforeHp: 1361, afterHp: 1408 }],
    ]);
    drill.dispose();
  });

  test("the Soul Split and unclaimed-orb heals coexist, and a protected transition hit heals nothing", () => {
    const drill = startDrill({ selection: { focus: "boss-heals", specialSelection: "replay-v2" } });
    drill.tickTo(13);
    drill.walkTo(drill.innerOrb());
    drill.tickTo(63);
    drill.pray("Protect from Range");
    drill.tickTo(68);
    expect(drill.events("special-hit").map((e) => [e.at, e.style, e.receipt.prayer, e.receipt.applied])).toEqual([[37, "magic", null, 49], [65, "ranged", "ranged", 9]]);
    expect(drill.events("boss-healed").map((e) => [e.at, e.cause, e.receipt])).toEqual([
      [39, { kind: "soul-split", ordinal: 0 }, { requested: 49, applied: 49, beforeHp: 1312, afterHp: 1361 }],
      [62, { kind: "unclaimed-orb" }, { requested: 25, applied: 25, beforeHp: 1361, afterHp: 1386 }],
    ]);
    drill.dispose();
  });

  test("one tick before each inner void from cycle 2, 2, 3, 4 and then 5 rifts spawn, each on its own floor tile 2 to 5 from the boss's 3x3, new each cycle", () => {
    const drill = startDrill({ selection: { focus: "rifts" } });
    drill.region.invincible = true;
    drill.tickTo(247);
    expect(drill.events("rift-spawned").map((e) => [e.at, e.rift, e.tile])).toEqual([
      [67, "rift-67-0", { x: 4, y: 2 }], [67, "rift-67-1", { x: 2, y: 1 }],
      [127, "rift-127-0", { x: 3, y: 1 }], [127, "rift-127-1", { x: 9, y: 4 }], [127, "rift-127-2", { x: 1, y: 4 }],
      [187, "rift-187-0", { x: 8, y: 4 }], [187, "rift-187-1", { x: 10, y: 1 }], [187, "rift-187-2", { x: 4, y: 10 }], [187, "rift-187-3", { x: 9, y: 4 }],
      [247, "rift-247-0", { x: 2, y: 4 }], [247, "rift-247-1", { x: 1, y: 3 }], [247, "rift-247-2", { x: 10, y: 1 }], [247, "rift-247-3", { x: 5, y: 9 }], [247, "rift-247-4", { x: 1, y: 11 }],
    ]);
    drill.dispose();
  });

  test("a rift never forms on a floor hole: seed 5's cycle 2 rifts in the full fight, beside the holes stacked on x 11", () => {
    const drill = startDrill({ seed: 5 });
    drill.region.invincible = true;
    drill.tickTo(67);
    expect([drill.region.fightLog().header.choices.floorHoleLayout.option.value.tiles, drill.events("rift-spawned").map((e) => e.tile)]).toEqual([
      [{ x: 11, y: 1 }, { x: 11, y: 2 }, { x: 11, y: 3 }],
      [{ x: 4, y: 9 }, { x: 1, y: 3 }],
    ]);
    drill.dispose();
  });

  test.each([
    {
      killLandsAt: 96,
      destroyed: [[97, "rift-67-1"]],
      bursts: [[97, ["rift-67-0"], { requested: 36, applied: 36, beforeHp: 99, afterHp: 63, prayer: null }]],
      chat: ["Destroying the void rift empowers you!"],
      secondRiftSequences: [14896, 14897],
    },
    {
      killLandsAt: 97,
      destroyed: [],
      bursts: [[97, ["rift-67-0", "rift-67-1"], { requested: 36, applied: 36, beforeHp: 99, afterHp: 63, prayer: null }]],
      chat: [],
      secondRiftSequences: [14896, 14898],
    },
  ])("guard: a rift dead by the end of 96 despawns and is destroyed at 97, and the rifts still standing at 97, 30 ticks after they rose, detonate and hit the player once: second rift killed by a hit landing at $killLandsAt", ({ killLandsAt, destroyed, bursts, chat, secondRiftSequences }) => {
    const drill = startDrill({ selection: { focus: "rifts" } });
    drill.tickTo(68);
    const second = secondRift(drill);
    const sequences: number[] = [];
    second.setAnimationListener({ animationChanged: (id) => Promise.resolve(void sequences.push(id)), modelChanged: () => undefined });
    drill.tickTo(killLandsAt - 1);
    drill.hit(drill.player(), second, 44);
    drill.tickTo(98);
    expect([drill.events("rift-destroyed").map((e) => [e.at, e.rift]), drill.events("rift-burst").map((e) => [e.at, e.rifts, e.receipt]), drill.region.chat(), sequences]).toEqual([
      destroyed,
      bursts,
      chat,
      secondRiftSequences,
    ]);
    drill.dispose();
  });

  test("destroying a rift resets the attack delay: the bow's shot at the other rift goes on the destroy tick, 73, and lands at 75, 2 ticks sooner than its 5-tick delay allows", async () => {
    const drill = startDrill({ selection: { focus: "rifts" } });
    drill.tickTo(68);
    await drill.click(riftTile(drill, SECOND_RIFT));
    drill.tickTo(72);
    await drill.click(riftTile(drill, FIRST_RIFT));
    drill.tickTo(78);
    expect([drill.events("rift-hit").map((e) => [e.at, e.rift, e.damage]), drill.events("rift-destroyed").map((e) => [e.at, e.rift, e.attackDelay])]).toEqual([
      [[72, "rift-67-1", 44], [75, "rift-67-0", 44]],
      [[73, "rift-67-1", { before: 2, after: 0 }], [76, "rift-67-0", { before: 3, after: 0 }]],
    ]);
    drill.dispose();
  });

  test.each([
    { lands: "on the tick it bursts", delays: [2], logged: [[97, "rift-67-1", "ranged", 44]] },
    { lands: "on the tick it is destroyed, after the hit that killed it", delays: [1, 2], logged: [[96, "rift-67-1", "ranged", 44], [97, "rift-67-1", "ranged", 44]] },
  ] as const)("guard: a hit landing on the second rift $lands logs its rift-hit", ({ delays, logged }) => {
    const drill = startDrill({ selection: { focus: "rifts" } });
    drill.tickTo(95);
    const second = secondRift(drill);
    delays.forEach((delay) => drill.hit(drill.player(), second, 44, "range", delay));
    drill.tickTo(98);
    expect(drill.events("rift-hit").map((e) => [e.at, e.rift, e.style, e.damage])).toEqual(logged);
    drill.dispose();
  });

  test("under each rift's HP bar a yellow timer bar of the same size fills from the left as the rift charges, full on the burst tick", () => {
    const drill = startDrill({ selection: { focus: "rifts" } });
    const drawn: Record<number, readonly Fill[]> = {};
    for (const t of [67, 69, 82, 96, 97]) {
      drill.tickTo(t);
      const first = drill.events("rift-spawned").some((e) => e.rift === FIRST_RIFT) ? riftMob(drill, FIRST_RIFT) : null;
      drawn[t] = first ? paintedFills((context) => first.drawHPBar(context, 1, 0)) : [];
    }
    const bars = (yellow: number): readonly Fill[] => [
      { style: "red", x: -15, y: 0, width: 30, height: 5 },
      { style: "lime", x: -15, y: 0, width: 30, height: 5 },
      { style: "#1e1e0c", x: -15, y: 5, width: 30, height: 5 },
      { style: "#e0c020", x: -15, y: 5, width: yellow, height: 5 },
    ];
    expect([drawn, drill.events("rift-burst").map((e) => [e.at, e.rifts])]).toEqual([
      { 67: bars(0), 69: bars(2), 82: bars(15), 96: bars(29), 97: bars(30) },
      [[97, ["rift-67-0", "rift-67-1"]]],
    ]);
    drill.dispose();
  });

  test("guard: a kill on the Soul Split tick ends the run before the boss heals", async () => {
    const fight = async (attacks: boolean) => {
      const drill = startDrill({ seed: 100, bossHp: 1, selection: TRANSITIONS });
      drill.tickTo(35);
      if (attacks) await drill.click(UNDER_BOSS);
      drill.tickTo(40);
      const seen = [drill.events("boss-healed").map((e) => e.at), drill.events("run-ended").map((e) => [e.at, e.reason])];
      drill.dispose();
      return seen;
    };
    expect([await fight(false), await fight(true)]).toEqual([
      [[39], []],
      [[], [[39, "kill"]]],
    ]);
  });
});
