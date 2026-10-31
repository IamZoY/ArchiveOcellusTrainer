import { AttackStyle, AttackStylesController, Settings, TrainerInstance, Viewport } from "osrs-sdk";
import { BossForm, FightPlayer } from "../fight/units";
import type { StartPhase } from "../full/options";
import type { FightRegion } from "../full/prefix";
import { fullFightStaged } from "../full/prefix";
import { PHASE_RANGED_DEFENCE, dressFullFight } from "../fight/blowpipe";
import { OCELLUS_P4 } from "../js/OcellusTimings";
import { QUADRANTS, quadrantOf } from "../fight/geometry";
import { startP3 } from "./p3run";

let close: (() => void) | null = null;
afterEach(() => {
  close?.();
  close = null;
});

function open(startPhase: StartPhase): FightRegion {
  Settings.readFromStorage();
  const region = fullFightStaged(
    { seed: 1, party: 1, startPhase, hazardTiles: false, videoMarkers: false, prayerGuide: false, mechanicsGuide: false, skipMarkers: false, patternMarkers: false, soloVine: true, invincible: true, defenceDrained: false },
    (player) => dressFullFight(player, "blowpipe"),
  );
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

function boss(region: FightRegion, phase: StartPhase): BossForm {
  const mounted = phase === 1 ? region.p1.mounted : phase === 2 ? region.p2.mounted : region.p3.mounted;
  if (!mounted) throw new Error(`phase ${phase} is not running`);
  return mounted.boss;
}

describe("the full fight's toxic blowpipe", () => {
  test("phase 1 and the blade have the wiki infobox's ranged defence", () => {
    expect({ p1: PHASE_RANGED_DEFENCE.p1, blade: PHASE_RANGED_DEFENCE.blade }).toEqual({ p1: { light: 50, standard: 135, heavy: 50 }, blade: { light: 100, standard: 110, heavy: 80 } });
  });

  test("Rapid is 2 ticks at 5 tiles, and Accurate and Longrange are 3, with the charged dragon-dart bonuses", () => {
    const region = open(1);
    const weapon = player(region).equipment.weapon;
    if (!weapon) throw new Error("the full fight dressed no weapon");
    const stance = (style: AttackStyle) => {
      AttackStylesController.controller.setWeaponAttackStyle(weapon, style);
      return { speed: weapon.attackSpeed, range: weapon.attackRange };
    };
    expect({
      name: weapon.itemName,
      id: weapon.cacheItemId,
      accurate: stance(AttackStyle.ACCURATE),
      rapid: stance(AttackStyle.RAPID),
      longrange: stance(AttackStyle.LONGRANGE),
      rangedAttack: weapon.bonuses.attack.range,
      rangedStrength: weapon.bonuses.other.rangedStrength,
    }).toEqual({
      name: "Toxic Blowpipe",
      id: 12926,
      accurate: { speed: 3, range: 5 },
      rapid: { speed: 2, range: 5 },
      longrange: { speed: 3, range: 7 },
      rangedAttack: 30,
      rangedStrength: 55,
    });
  });

  test("phase 1, 2 and 3 each start with it worn, and phase 1 and 2 roll darts against light ranged defence", () => {
    const worn = (phase: StartPhase) => {
      const region = open(phase);
      try {
        const name = player(region).equipment.weapon?.itemName ?? null;
        if (phase === 1) {
          for (let guard = 0; boss(region, 1).form !== "p1" && guard < 5; guard++) region.world.tickWorld();
        }
        return { name, range: boss(region, phase).bonuses.defence.range };
      } finally {
        close?.();
        close = null;
      }
    };
    expect({
      ranged: worn(1),
      blade: worn(2),
      phase3: worn(3),
    }).toEqual({
      ranged: { name: "Toxic Blowpipe", range: 50 },
      blade: { name: "Toxic Blowpipe", range: 100 },
      phase3: { name: "Toxic Blowpipe", range: 250 },
    });
  });

  test("phase 1 shoots Ocellus with it every 2 ticks once he can be attacked", () => {
    const region = open(1);
    const you = player(region);
    const ocellus = boss(region, 1);
    for (let guard = 0; !ocellus.attackable && guard < 8; guard++) region.world.tickWorld();
    you.setAggro(ocellus);
    const delays: number[] = [];
    const started = ocellus.currentStats.hitpoint;
    let lowest = started;
    for (let tick = 0; tick < 12; tick++) {
      region.world.tickWorld();
      delays.push(you.attackDelay);
      lowest = Math.min(lowest, ocellus.currentStats.hitpoint);
    }
    expect({ attackable: ocellus.attackable, form: ocellus.form, delays, hit: lowest < started }).toEqual({
      attackable: true,
      form: "p1",
      delays: [2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1],
      hit: true,
    });
  });

  function carried(you: FightPlayer): (number | null)[] {
    return you.inventory.map((item) => (typeof item?.cacheItemId === "number" ? item.cacheItemId : null));
  }

  test("a click swaps the blowpipe and the twisted bow, and the next click swaps them back", () => {
    const region = open(1);
    const you = player(region);
    const slot = you.inventory.findIndex((item) => item?.cacheItemId === 20997);
    const bow = slot >= 0 ? you.inventory[slot] : null;
    expect(bow?.itemName ?? null).toBe("Twisted Bow");
    if (!bow) return;
    bow.inventoryLeftClick(you);
    const stowed = you.inventory[slot];
    expect({ worn: you.equipment.weapon?.itemName ?? null, stowed: stowed?.itemName ?? null }).toEqual({
      worn: "Twisted Bow",
      stowed: "Toxic Blowpipe",
    });
    if (!stowed) return;
    stowed.inventoryLeftClick(you);
    expect({ worn: you.equipment.weapon?.itemName ?? null, stowed: you.inventory[slot]?.itemName ?? null }).toEqual({
      worn: "Toxic Blowpipe",
      stowed: "Twisted Bow",
    });
  });

  test("the blowpipe and the twisted bow are both still carried after the fall into phase 4", () => {
    const run = startP3({ weapon: "blowpipe" });
    try {
      const fallTo = (count: number) => {
        for (let guard = 0; run.live().arena.destroyed.size < count; guard++) {
          if (guard > 100) throw new Error(`quadrant ${count} never fell`);
          run.tickOnce();
          if (run.region.current !== "p3") return;
          const crumbling = run.live().arena.floorState().crumbling;
          if (crumbling.length > 0 && quadrantOf(run.here()) === crumbling[0]) run.stepOff();
        }
      };
      for (const [floor, count] of [[75, 1], [50, 2]] as const) {
        run.tickTo(run.now() + 2, run.stayInReach);
        run.bossAt(floor);
        fallTo(count);
      }
      run.tickTo(run.now() + 2, run.stayInReach);
      run.bossAt(25);
      while (run.live().arena.floorState().crumbling.length === 0) run.tickOnce();
      const left = QUADRANTS.filter((quadrant) => !run.live().arena.destroyed.has(quadrant) && !run.live().arena.floorState().crumbling.includes(quadrant));
      const standing = left[0];
      if (!standing) throw new Error("no quadrant was left to stand on");
      run.standOn(standing);
      fallTo(3);
      const you = run.player();
      const ids = carried(you);
      expect({
        phase: run.region.current,
        worn: you.equipment.weapon?.cacheItemId ?? null,
        bow: ids.includes(20997),
        pipe: you.equipment.weapon?.cacheItemId === OCELLUS_P4.gear.blowpipe.value.itemId || ids.includes(OCELLUS_P4.gear.blowpipe.value.itemId),
      }).toEqual({ phase: "p4", worn: OCELLUS_P4.gear.blowpipe.value.itemId, bow: true, pipe: true });
    } finally {
      run.close();
    }
  });
});
