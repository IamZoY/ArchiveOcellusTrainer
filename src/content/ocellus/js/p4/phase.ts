import { SoundCache, cacheSound } from "osrs-sdk";
import type { CatalogLoadout } from "osrs-sdk";
import type { DrillConfig } from "../OcellusTimings";
import { OCELLUS_P4 } from "../OcellusTimings";
import { dressOcellus } from "../OcellusLoadout";
import type { LingeringVoid, TickRow } from "../P4Types";
import type { TickSpan } from "../../../../sim/brands";
import { after, span } from "../../../../sim/brands";
import type { Entries, PhaseDef, Rules } from "../../../../sim/encounter";
import type { Frame } from "../../../../sim/frame";
import { identity, toRoom } from "../../../../sim/frame";
import type { EncounterPlayer } from "../../../../sim/sdk/EncounterPlayer";
import type { EncounterHost } from "../../../../sim/sdk/EncounterRegion";
import { ExplosionViews } from "../entities/ExplosionViews";
import { BossLook, FloorHole, FragmentFlash, OrbView, PlayerLook, VoidField, warmSpotAnim } from "../entities/P4Views";
import { BossFootprint, Ocellus } from "../mobs/Ocellus";
import { PLATFORM_ROOM } from "../rooms/platform";
import { PLATFORM } from "./floor";
import type { Views } from "./present";
import { presentRow } from "./present";

/** What the full fight's guides read off a running P4: its prayer cues, its explosion marks and its schedule ahead. */
export { specialCues } from "./cues";
export { markedOn, p4Threats } from "./threats";
export type { Marked } from "./threats";

/**
 * A drill entry dresses a fresh player on P4's own platform, which only the mechanic tests run. The full fight's third fall carries the player as it stands, so
 * only the boss's HP and Defence, where the platform lies in the room, and phase 3's voids cross.
 */
export type P4Entry =
  | Readonly<{ kind: "drill"; config: DrillConfig; loadout: CatalogLoadout }>
  | Readonly<{ kind: "carried"; config: DrillConfig; frame: Frame; boss: Readonly<{ hp: number; defence: number }>; voids: readonly LingeringVoid[] }>;

export type P4Mount = Readonly<{ ocellus: Ocellus; player: EncounterPlayer; views: Views; frame: Frame }>;

/** The page's hold on the running P4: its practice toggle, and the units its probe and chat read. */
export type P4Watch = { invincible: boolean; mounted: P4Mount | null };

type Arrival = Readonly<{
  config: DrillConfig;
  frame: Frame;
  voids: readonly LingeringVoid[];
  /** P4 ticks that passed before this phase opened its first row. */
  passed: TickSpan;
  enter(player: EncounterPlayer): void;
  ready(ocellus: Ocellus): void;
}>;

/** The fall's own tick is P4's tick 0 and the prefix's last, so a carried P4 opens on tick 1. */
const FALL_TICK = span(1);

function arrival(entry: P4Entry): Arrival {
  switch (entry.kind) {
    case "drill":
      return {
        config: entry.config,
        frame: identity(PLATFORM_ROOM.size),
        voids: [],
        passed: span(0),
        enter: (player) => dressOcellus(player, entry.loadout),
        ready: (ocellus) => ocellus.enterP4(),
      };
    case "carried":
      return {
        config: { ...entry.config, bossEntryHp: entry.boss.hp },
        frame: entry.frame,
        voids: entry.voids,
        passed: FALL_TICK,
        enter: () => undefined,
        ready: (ocellus) => {
          ocellus.enterP4();
          ocellus.drainDefenceTo(entry.boss.defence);
        },
      };
    default: {
      const unhandled: never = entry;
      return unhandled;
    }
  }
}

const { sounds } = OCELLUS_P4.presentation;

function rules(player: EncounterPlayer): Rules {
  return {
    judge: () => {
      throw new Error("P4's boss judges each hit itself, on its binding's turn");
    },
    hpFloor: () => {
      throw new Error("P4's boss floors its own HP");
    },
    walk: () => ({ kind: "sdk" }),
    canAttack: (target) => {
      const swingsMelee = !player.manualSpellCastSelection && player.equipment.weapon?.isMeleeAttack === true;
      return !(swingsMelee && target instanceof Ocellus && target.outOfMeleeReach());
    },
    lineOfSight: () => "sdk",
  };
}

/** `closed` takes each closed row, for the guides that read P4 as it runs. */
export function p4Phase<E extends Entries & Readonly<{ p4: P4Entry }>>(watch: P4Watch, closed: (row: TickRow) => void): PhaseDef<E, "p4", TickRow, EncounterHost<E>> {
  return {
    name: "p4",
    enter({ region, room, player, bind }, entry) {
      const { config, frame, voids, passed, ...arrived } = arrival(entry);
      const ocellus = new Ocellus(region, config, player, () => watch.invincible, (start, hooks) => bind(after(start, passed), hooks), frame, voids);
      const floor = PLATFORM.tiles().map((at) => toRoom(frame, at));
      room.walkable(floor);
      if (!floor.some((at) => at.x === player.location.x && at.y === player.location.y)) player.hop(toRoom(frame, OCELLUS_P4.geometry.playerSpawn.value));
      arrived.enter(player);
      Object.values(sounds).forEach((sound) => SoundCache.preload(cacheSound(sound.value)));
      const views: Views = {
        field: new VoidField(region, frame),
        holes: ocellus.holes.tiles().map((at) => new FloorHole(region, toRoom(frame, at))),
        orbs: { "inner-void": new OrbView(region), "outer-void": new OrbView(region) },
        fragment: new FragmentFlash(region),
        explosions: new ExplosionViews(region),
        boss: new BossLook(ocellus),
        player: new PlayerLook(player),
        chat: [],
      };
      [views.field, ...views.holes, views.orbs["inner-void"], views.orbs["outer-void"], views.fragment].forEach((view) => region.addEntity(view));
      void warmSpotAnim(views.orbs["inner-void"], OCELLUS_P4.explosion.spotAnim.value).catch((error: unknown) => console.error("explosion spotanim did not warm", error));
      region.addEntity(new BossFootprint(region, ocellus));
      region.addMob(ocellus);
      region.setBoss(ocellus);
      watch.mounted = { ocellus, player, views, frame };
      return {
        frame,
        rules: rules(player),
        ready: () => arrived.ready(ocellus),
        openTick: () => ocellus.binding.openTick(),
        finishTick: () => {
          const row = ocellus.binding.finishTick();
          if (!row) return;
          presentRow(row, views, frame);
          closed(row);
        },
        rows: () => ocellus.binding.rows,
        leave: () => {
          throw new Error("P4 is the boss's last phase, so nothing enters after it");
        },
      };
    },
  };
}
