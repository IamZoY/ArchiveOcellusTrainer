import { Settings, TrainerInstance, Viewport } from "osrs-sdk";
import { P3 } from "../fight/data";
import type { ATile, Quadrant } from "../fight/geometry";
import { QUADRANTS, quadrantOf, quadrantTiles } from "../fight/geometry";
import { FightPlayer } from "../fight/units";
import type { P3Mount } from "../full/p3/sdk/phase";
import type { FullFightOptions } from "../full/prefix";
import { FightRegion } from "../full/prefix";

/**
 * The quadrant falls 13 ticks after it starts to collapse, and the collapse starts the tick after his HP is at the
 * floor. Landing is tick 6, so a floor set just after landing falls on tick 20.
 */
const FALL_TICK = 20;
const DEATH_SCREEN_TICK = 24;

describe("a falling quadrant", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  function open(practice: boolean) {
    Settings.readFromStorage();
    const options: FullFightOptions = {
      seed: 1,
      party: 1,
      startPhase: 3,
      hazardTiles: false,
      videoMarkers: false, prayerGuide: false, mechanicsGuide: false,
      skipMarkers: false,
      patternMarkers: false,
      soloVine: true,
      invincible: practice,
      defenceDrained: false,
    };
    const region = new FightRegion(options, () => undefined);
    const trainer = new TrainerInstance(region, { force2d: true });
    trainer.mount(document.createElement("canvas"), document.createElement("div"));
    region.world.getReadyTimer = 0;
    Viewport.viewport.resize(800, 600);
    const mounted = region.p3.mounted;
    const player = region.players[0];
    if (!mounted || !(player instanceof FightPlayer)) throw new Error("the region did not start phase 3");
    close = () => trainer.dispose();
    const now = () => region.rows("p3").at(-1)?.tick ?? -1;
    const tick = () => region.world.tickWorld();
    const tickTo = (n: number) => {
      let guard = 0;
      while (now() < n) {
        tick();
        if (++guard > 400) throw new Error(`the fight stuck at tick ${now()}, outcome ${mounted.script.outcome.kind}`);
      }
    };
    const enteredP4 = () => region.current === "p4";
    const fight: P3Fight = { region, p3: mounted, player, now };
    return { fight, tick, tickTo, enteredP4 };
  }

  type P3Fight = Readonly<{ region: FightRegion; p3: P3Mount; player: FightPlayer; now: () => number }>;

  /** His HP at a whole-number percentage, set between ticks so the next tick can start the collapse. */
  function floorBoss(fight: P3Fight, shown = 75): void {
    const { boss } = fight.p3;
    boss.currentStats.hitpoint = Math.ceil((boss.stats.hitpoint * shown) / 100);
  }

  function standOn(fight: P3Fight, quadrant: Quadrant): ATile {
    const tile = quadrantTiles(quadrant).find((t) => fight.p3.arena.isWalkable(t));
    if (!tile) throw new Error(`no floor in ${quadrant}`);
    fight.player.hop(tile);
    return tile;
  }

  function otherThan(fight: P3Fight, here: Quadrant | null): Quadrant {
    const next = QUADRANTS.find((q) => q !== here && !fight.p3.arena.destroyed.has(q));
    if (!next) throw new Error("no standing quadrant");
    return next;
  }

  function consumed(fight: P3Fight): readonly (readonly [number, string])[] {
    return fight.region.chat().filter((line) => line.text === "The void consumes you." || line.text === "Oh dear, you are dead!").map((line) => [line.tick, line.text]);
  }

  function playerState(fight: P3Fight): readonly [number, number, P3Mount["script"]["outcome"]["kind"]] {
    return [fight.player.currentStats.hitpoint, fight.player.dying, fight.p3.script.outcome.kind];
  }

  const here = (fight: P3Fight) => quadrantOf(fight.player.arenaTile());
  const collapses = (fight: P3Fight) => fight.region.chat().filter((line) => line.text === "The quadrant begins to collapse! Jump across the stones!").length;

  function killed({ fight, tickTo, enteredP4 }: ReturnType<typeof open>): void {
    tickTo(P3.jumpToCornerAfter);
    const home = here(fight);
    if (!home) throw new Error("the player is not in a quadrant");
    floorBoss(fight);
    tickTo(FALL_TICK);
    expect({ tick: fight.now(), home, state: playerState(fight), chat: consumed(fight), enteredP4: enteredP4() }).toEqual({
      tick: FALL_TICK,
      home,
      state: [0, 4, "running"],
      chat: [[FALL_TICK, "The void consumes you."]],
      enteredP4: false,
    });
    tickTo(DEATH_SCREEN_TICK);
    expect({
      tick: fight.now(),
      state: playerState(fight),
      outcome: fight.p3.script.outcome,
      chat: consumed(fight),
      enteredP4: enteredP4(),
      crumbling: [...fight.p3.arena.floorState().crumbling],
      fell: [...fight.p3.arena.destroyed],
      hidden: fight.p3.boss.hidden,
      collapses: collapses(fight),
    }).toEqual({
      tick: DEATH_SCREEN_TICK,
      state: [0, 0, "lost"],
      outcome: { kind: "lost", at: DEATH_SCREEN_TICK },
      chat: [
        [FALL_TICK, "The void consumes you."],
        [DEATH_SCREEN_TICK, "Oh dear, you are dead!"],
      ],
      enteredP4: false,
      crumbling: [],
      fell: [home],
      hidden: true,
      collapses: 1,
    });
  }

  test("standing on the quadrant at the fall tick kills the player with practice on", () => {
    killed(open(true));
  });

  test("standing on the quadrant at the fall tick kills the player with practice off", () => {
    killed(open(false));
  });

  test("guard: standing on a quadrant that is still there leaves the player alive", () => {
    const { fight, tickTo, enteredP4 } = open(false);
    tickTo(P3.jumpToCornerAfter);
    const home = here(fight);
    const safe = standOn(fight, otherThan(fight, home));
    floorBoss(fight);
    tickTo(FALL_TICK);
    expect({
      tick: fight.now(),
      tile: fight.player.arenaTile(),
      state: playerState(fight),
      chat: consumed(fight),
      enteredP4: enteredP4(),
      fell: [...fight.p3.arena.destroyed],
    }).toEqual({
      tick: FALL_TICK,
      tile: safe,
      state: [99, -1, "running"],
      chat: [],
      enteredP4: false,
      fell: home ? [home] : [],
    });
    tickTo(DEATH_SCREEN_TICK);
    expect(playerState(fight)).toEqual([99, -1, "running"]);
  });

  test("guard: leaving on the tick before the fall leaves the player alive", () => {
    const { fight, tickTo, enteredP4 } = open(false);
    tickTo(P3.jumpToCornerAfter);
    const home = here(fight);
    if (!home) throw new Error("the player is not in a quadrant");
    floorBoss(fight);
    tickTo(FALL_TICK - 1);
    const safe = standOn(fight, otherThan(fight, home));
    tickTo(FALL_TICK);
    expect({
      tick: fight.now(),
      tile: fight.player.arenaTile(),
      state: playerState(fight),
      chat: consumed(fight),
      enteredP4: enteredP4(),
      fell: [...fight.p3.arena.destroyed],
    }).toEqual({
      tick: FALL_TICK,
      tile: safe,
      state: [99, -1, "running"],
      chat: [],
      enteredP4: false,
      fell: [home],
    });
  });

  test.each([true, false])("standing on the third quadrant when it falls kills the player and does not start phase 4, practice %s", (practice) => {
    const { fight, tick, tickTo, enteredP4 } = open(practice);
    tickTo(P3.jumpToCornerAfter);
    const untilFallen = (count: number) => {
      let guard = 0;
      while (fight.p3.arena.destroyed.size < count) {
        tick();
        if (++guard > 80) throw new Error(`quadrant ${count} never fell, tick ${fight.now()}`);
      }
    };
    const untilBossReturns = () => {
      let guard = 0;
      while (fight.p3.boss.hidden) {
        tick();
        if (++guard > 30) throw new Error(`the boss stayed hidden at tick ${fight.now()}`);
      }
    };
    for (const [shown, count] of [
      [75, 1],
      [50, 2],
    ] as const) {
      untilBossReturns();
      floorBoss(fight, shown);
      standOn(fight, otherThan(fight, here(fight)));
      untilFallen(count);
    }
    untilBossReturns();
    floorBoss(fight, 25);
    const home = here(fight);
    if (!home) throw new Error("the player left the last quadrant");
    untilFallen(3);
    const fallTick = fight.now();
    expect({ home, state: playerState(fight), chat: consumed(fight), enteredP4: enteredP4() }).toEqual({
      home,
      state: [0, 4, "running"],
      chat: [[fallTick, "The void consumes you."]],
      enteredP4: false,
    });
    tickTo(fallTick + 4);
    expect({
      outcome: fight.p3.script.outcome,
      enteredP4: enteredP4(),
      crumbling: [...fight.p3.arena.floorState().crumbling],
      fell: fight.p3.arena.destroyed.size,
      hidden: fight.p3.boss.hidden,
      collapses: collapses(fight),
    }).toEqual({
      outcome: { kind: "lost", at: fallTick + 4 },
      enteredP4: false,
      crumbling: [],
      fell: 3,
      hidden: true,
      collapses: 3,
    });
  });
});
