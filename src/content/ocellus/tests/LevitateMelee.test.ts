import { Settings, TrainerInstance, Viewport } from "osrs-sdk";
import { dressFullFight } from "../fight/blowpipe";
import { FightPlayer } from "../fight/units";
import type { FullFightOptions } from "../full/prefix";
import { FightRegion } from "../full/prefix";

describe("a melee player targeting the levitating boss", () => {
  test("at 0 hitpoints dies on the next ticks, and the swing is refused", () => {
    Settings.readFromStorage();
    const options: FullFightOptions = {
      seed: 1,
      party: 1,
      startPhase: 3,
      hazardTiles: true,
      videoMarkers: false, prayerGuide: false, mechanicsGuide: false,
      skipMarkers: false,
      patternMarkers: false,
      soloVine: true,
      invincible: true,
      defenceDrained: false,
    };
    const region = new FightRegion(options, (player) => dressFullFight(player, "melee"));
    const trainer = new TrainerInstance(region, { force2d: true });
    trainer.mount(document.createElement("canvas"), document.createElement("div"));
    region.world.getReadyTimer = 0;
    Viewport.viewport.resize(800, 600);
    const p3 = region.p3.mounted;
    const player = region.players[0];
    if (!p3 || !(player instanceof FightPlayer)) throw new Error("the region did not start phase 3");
    const said = (text: string) => region.rows("p3").flatMap((row) => row.events.flatMap((e) => (e.kind === "boss-changed" && e.change.kind === "said" && e.change.text === text ? [row.tick] : [])));
    let untether = -1;
    for (let guard = 0; untether < 0 && guard < 400; guard++) {
      region.world.tickWorld();
      untether = said("Untether...")[0] ?? -1;
    }
    if (untether < 0) throw new Error("Untether did not start");
    const { boss } = p3;
    player.setAggro(boss);
    player.attackDelay = 0;
    for (let step = 0; step < 9; step++) region.world.tickWorld();
    const flying = region.chat().filter((line) => line.text.startsWith("It's flying too high")).map((line) => line.tick);
    player.setAggro(boss);
    region.setPractice(false);
    player.currentStats.hitpoint = 0;
    const after: [number, number, number, string][] = [];
    for (let step = 0; step < 3; step++) {
      region.world.tickWorld();
      after.push([p3.now(), player.currentStats.hitpoint, player.dying, p3.script.outcome.kind]);
    }
    trainer.dispose();
    expect({ weapon: player.equipment.weapon?.itemName ?? null, untether, flying, after }).toEqual({
      weapon: "Scythe of Vitur",
      untether: 59,
      flying: [60, 63, 66],
      after: [
        [69, 0, 4, "running"],
        [70, 0, 3, "running"],
        [71, 0, 2, "running"],
      ],
    });
  }, 120000);
});
