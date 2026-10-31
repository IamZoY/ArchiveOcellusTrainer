import { DelayedAction, Player, Projectile, Settings, TestNpc, TestRegion, Viewport, World } from "osrs-sdk";
import type { Location, MovePace, Region } from "osrs-sdk";
import type { Tick } from "../brands";
import { seed, span, tick } from "../brands";
import type { EncounterBinding, Hooks } from "./EncounterBinding";

type Probe = Readonly<{ input: string; event: string; cause: string; snapshot: number; row: string; end: "kill" }>;
type Bound = () => EncounterBinding<Probe>;

const loadBindingInEachTest = () => vi.importActual<typeof import("./EncounterBinding")>("./EncounterBinding");

class ProbeRegion extends TestRegion {
  constructor(private readonly binding: Bound) {
    super(40, 40);
  }

  override beforeNpcTurns(): void {
    this.binding().openTick();
  }

  override postTick(): void {
    this.binding().finishTick();
  }
}

class ProbeNpc extends TestNpc {
  constructor(region: Region, at: Location, private readonly binding: Bound) {
    super(region, at, {});
  }

  override queueStep(): void {
    this.binding().npcTurn(this, () => super.queueStep());
  }
}

class ProbePlayer extends Player {
  constructor(region: Region, at: Location, private readonly binding: Bound) {
    super(region, at);
  }

  override moveTo(x: number, y: number, pace: MovePace = "run-setting"): void {
    super.moveTo(x, y, pace);
    this.binding().input(`walk to (${x}, ${y})`);
  }

  override postAttacksEvent(): void {
    super.postAttacksEvent();
    this.binding().playerHitsSettled();
  }

  override movementStep(): void {
    this.binding().playerMovement(() => super.movementStep());
  }
}

async function encounter(start: Tick, judged: number) {
  const { EncounterBinding: Binding } = await loadBindingInEachTest();
  const frames: string[] = [];
  const region: ProbeRegion = new ProbeRegion(() => binding);
  const world = new World();
  region.world = world;
  world.addRegion(region);
  Viewport.setupViewport(region, document.createElement("canvas"), document.createElement("div"), true);
  const player: ProbePlayer = new ProbePlayer(region, { x: 20, y: 20 }, () => binding);
  const npc: ProbeNpc = new ProbeNpc(region, { x: 10, y: 10 }, () => binding);
  npc.stunned = 0;
  region.addPlayer(player);
  region.addMob(npc);
  Viewport.viewport.setPlayer(player);
  const hooks: Hooks<Probe> = {
    "tick-opened": ({ kind, time }) => {
      frames.push(`${time.encounter} ${kind} at world tick ${time.world}`);
    },
    "before-npc-hits": ({ kind, time, incoming }) => {
      frames.push(`${time.encounter} ${kind} ${incoming.map((hit) => `${hit.style} ${hit.requested} from ${hit.launchedAt}`).join(", ")}`);
      return {
        snapshot: npc.currentStats.hitpoint,
        outputs: [...incoming.map((hit) => ({ kind: "judge-incoming", hit, damage: judged } as const)), { kind: "event", event: `judged ${incoming.length}` }],
      };
    },
    "npc-turn": ({ kind, time, snapshot, player: { attackDelay } }) => {
      frames.push(`${time.encounter} ${kind} from ${snapshot} hp at attack delay ${attackDelay}`);
      return {
        outputs: [{ kind: "event", event: "turned" }, { kind: "hit", damage: { kind: "fixed", amount: 3 }, cause: `strike ${time.encounter}` }, { kind: "cut-attack-delay", by: span(3) }],
        ending: npc.currentStats.hitpoint <= 0 ? "kill" : null,
      };
    },
    "hit-applied": ({ kind, time, hit: { cause, receipt } }) => {
      frames.push(`${time.encounter} ${kind} ${cause}: ${receipt.beforeHp} to ${receipt.afterHp}`);
      return [`landed ${cause}`];
    },
    "player-hits-settled": ({ kind, time, landed, player: { hp, maxHp } }) => {
      frames.push(`${time.encounter} ${kind} ${landed.map(({ cause }) => cause).join(", ")} at ${hp} of ${maxHp} hp`);
      return [{ kind: "event", event: "settled" }, { kind: "heal", amount: 5, limit: "max-hp" }];
    },
    "player-moved": ({ kind, time, steps, at }) => {
      frames.push(`${time.encounter} ${kind} ${steps.map(({ x, y }) => `(${x}, ${y})`).join(" ")} to (${at.x}, ${at.y}) at ${player.currentStats.hitpoint} hp`);
    },
    "tick-ended": ({ kind, time, inputs, events, ending }) => {
      frames.push(`${time.encounter} ${kind}${ending === null ? "" : ` ${ending}`}`);
      return { row: `${time.encounter}: [${inputs.join(", ")}] ${events.join(", ")}`, ending };
    },
  };
  const binding: EncounterBinding<Probe> = new Binding(seed(1), start, () => player, hooks);
  return { world, player, npc, binding, frames };
}

describe("EncounterBinding", () => {
  beforeEach(() => {
    Settings.readFromStorage();
    DelayedAction.reset();
  });

  test("frames follow the SDK's tick once each, from the first world tick after GET READY, with judged hits and requested hits landing in order, the NPC turn's attack-delay cut applied to the player, and settlement heals applied up to max HP before the player moves", async () => {
    const { world, player, npc, binding, frames } = await encounter(tick(5), 7);
    world.getReadyTimer = 2;
    player.running = false;
    player.attackDelay = 9;
    player.moveTo(23, 20);
    world.tickWorld(2);
    npc.addProjectile(new Projectile(null, 20, player, npc, "slash", { setDelay: 1 }));
    world.tickWorld();

    expect({ frames, rows: binding.rows, npcHp: npc.currentStats.hitpoint, run: binding.view() }).toEqual({
      frames: [
        "5 tick-opened at world tick 2",
        "5 before-npc-hits ",
        "5 npc-turn from 125 hp at attack delay 9",
        "5 hit-applied strike 5: 99 to 96",
        "5 player-hits-settled strike 5 at 96 of 99 hp",
        "5 player-moved (22, 20) to (22, 20) at 99 hp",
        "5 tick-ended",
        "6 tick-opened at world tick 3",
        "6 before-npc-hits melee 20 from 5",
        "6 npc-turn from 125 hp at attack delay 5",
        "6 hit-applied strike 6: 99 to 96",
        "6 player-hits-settled strike 6 at 96 of 99 hp",
        "6 player-moved (23, 20) to (23, 20) at 99 hp",
        "6 tick-ended",
      ],
      rows: ["5: [walk to (23, 20)] judged 0, turned, landed strike 5, settled", "6: [] judged 1, turned, landed strike 6, settled"],
      npcHp: 118,
      run: { kind: "running", at: 6 },
    });
  });

  test("an ending on the NPC turn still lands that tick's hits and closes its row, then nothing runs", async () => {
    const { world, player, npc, binding, frames } = await encounter(tick(0), 125);
    npc.addProjectile(new Projectile(null, 20, player, npc, "slash", { setDelay: 1 }));
    player.moveTo(22, 20);
    world.tickWorld(2);

    expect({ frames, rows: binding.rows, location: player.location, run: binding.view() }).toEqual({
      frames: [
        "0 tick-opened at world tick 1",
        "0 before-npc-hits melee 20 from 0",
        "0 npc-turn from 125 hp at attack delay 0",
        "0 hit-applied strike 0: 99 to 96",
        "0 tick-ended kill",
      ],
      rows: ["0: [walk to (22, 20)] judged 1, turned, landed strike 0"],
      location: { x: 22, y: 20 },
      run: { kind: "ended", at: 0, reason: "kill" },
    });
  });
});
