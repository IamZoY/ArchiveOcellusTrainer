import type { Player } from "osrs-sdk";
import { tick } from "../../../../../sim/brands";
import type { Tick } from "../../../../../sim/brands";
import type { CueChange } from "../../../../../sim/prayerCue";
import type { ThreatChange } from "../../../../../sim/threat";
import type { Enter, Entries, Mounted, PhaseDef } from "../../../../../sim/encounter";
import { identity } from "../../../../../sim/frame";
import type { BossChange } from "../../../../../sim/script";
import { ScriptRun, cueChanges, threatChanges } from "../../../../../sim/script";
import type { EncounterBinding, Hooks } from "../../../../../sim/sdk/EncounterBinding";
import type { PlayerInput } from "../../../../../sim/sdk/EncounterPlayer";
import type { EncounterHost } from "../../../../../sim/sdk/EncounterRegion";
import { GRID } from "../../../fight/geometry";
import type { ATile } from "../../../fight/geometry";
import { at } from "../../../fight/geometry";
import { FightPlayer } from "../../../fight/units";
import type { P1Cause, P1Entry, P1Row, P1Types } from "../types";
import { P1Script } from "../script";
import { Arena } from "./arena";
import { P1Boss, queueHeal } from "./boss";
import type { ChatLine } from "../../options";
import { CHAT } from "../../options";
import { P1Views } from "./views";

type P1Encounter = Readonly<{ input: PlayerInput; event: never; cause: P1Cause; snapshot: null; row: P1Row; end: never }>;

/** The sidebar's toggles: practice, the danger tiles, and whether his Defence opens drained. */
export type P1Settings = Readonly<{ practice: () => boolean; hazardTiles: () => boolean; defenceDrained: () => boolean }>;

export type P1Mount = Readonly<{ boss: P1Boss; views: P1Views; arena: Arena; script: P1Script<Entries>; now: () => number; started: () => boolean }>;
/** The page's hold on the running phase 1. */
export type P1Watch = { mounted: P1Mount | null };

export type P1Options<E extends Entries> = Readonly<{
  settings: P1Settings;
  watch: P1Watch;
  /** The chatbox outlives the phase, so its lines go to whoever keeps it. */
  say: (line: ChatLine) => void;
  /** His phase 1 pool, already scaled for the party. */
  hp: number;
  /** Where the ending leads. `from` is phase 2's tick 0 on the fight clock. */
  intoP2: (from: number) => Enter<E>;
  /** The page follows a death or a victory that happens between ticks. */
  changed: () => void;
  /** The prayer guide takes each closed row's cue changes, on this phase's clock. */
  told: (now: Tick, changes: readonly CueChange[]) => void;
  /** The mechanics guide takes each closed row's warnings, on this phase's clock. */
  warned: (now: Tick, changes: readonly ThreatChange<ATile>[]) => void;
}>;

const HOODED = at(-1, -4);

function applied(boss: P1Boss, player: Player, change: BossChange<P1Types>): void {
  switch (change.kind) {
    case "animation":
      void boss.playAnimation(change.id);
      return;
    case "pose":
      boss.pose = change.id;
      return;
    case "said":
      boss.setOverheadText(change.text);
      boss.overheadTextTimer = change.lasts;
      return;
    case "overhead":
      boss.overhead = change.overhead;
      return;
    case "faced-player":
      boss.face(player);
      return;
    case "faced-tile":
      boss.faceTile(change.tile);
      return;
    case "stepped":
      boss.stepTo(change.to);
      return;
    case "jumped":
      throw new Error("phase 1 does not jump");
    case "placed":
      boss.teleport(change.to);
      return;
    case "shown":
      boss.hidden = !change.visible;
      return;
    case "targetable":
      boss.attackable = change.targetable;
      return;
    case "spotanim":
      boss.addSpotAnim({ id: change.id, channel: change.channel });
      return;
    default: {
      const unhandled: never = change;
      return unhandled;
    }
  }
}

/** Phase 1 written as closures, on the run's one player and in the full fight's arena. */
export function p1Phase<E extends Entries & Readonly<{ p1: P1Entry }>>(options: P1Options<E>): PhaseDef<E, "p1", P1Row, EncounterHost<E>> {
  const { settings, watch } = options;
  return {
    name: "p1",
    enter(host): Mounted<P1Row> {
      const { region, player } = host;
      if (!(player instanceof FightPlayer)) throw new Error("phase 1 runs on the full fight's player");
      const poolMax = options.hp;
      let binding: EncounterBinding<P1Encounter> | null = null;
      const boss = new P1Boss(
        region,
        HOODED,
        {
          allowsDeath: () => false,
          afterHits: (form) => {
            form.currentStats.hitpoint = Math.max(form.currentStats.hitpoint, script.hpFloor());
            if (form.form === "p1" && form.currentStats.hitpoint === 0) script.fell(run);
          },
          acceptsAttack: (form, style) => form.form === "p1" && !script.ended && !(style === "melee" && form.overhead === "protect-melee"),
          incomingDamageFactor: () => 1,
          defenceDrained: settings.defenceDrained,
        },
        poolMax,
        (actor, resolve) => {
          if (binding === null) resolve();
          else binding.npcTurn(actor, resolve);
        },
      );
      boss.currentStats.hitpoint = poolMax;
      const arena = new Arena(region, player, boss);
      const script: P1Script<E> = new P1Script<E>(
        arena,
        options.intoP2,
        (text, atTick) => options.say({ text, colour: CHAT.game, tick: atTick }),
        options.changed,
      );
      const run = new ScriptRun<E, P1Types>(
        script,
        {
          seed: host.seed,
          body: {
            at: () => boss.tile,
            hp: () => boss.currentStats.hitpoint,
            maxHp: () => boss.stats.hitpoint,
            defence: () => boss.currentStats.defence,
            apply: (change) => applied(boss, player, change),
            heal: (amount) => boss.heal(amount),
          },
          player: () => ({ tile: player.arenaTile(), hp: player.currentStats.hitpoint, prayer: player.protection() }),
          healPlayer: (amount) => {
            if (player.currentStats.hitpoint <= 0) return;
            queueHeal(boss, player, amount);
          },
          next: (to) => host.next(to),
        },
        tick(0),
      );
      const hooks: Hooks<P1Encounter> = {
        "tick-opened": ({ time }) => run.open(time.encounter, time.world),
        "before-npc-hits": () => ({ snapshot: null, outputs: [] }),
        "npc-turn": () => ({ outputs: run.requested().map(({ cause, damage }) => ({ kind: "hit", damage, cause })), ending: null }),
        "hit-applied": ({ hit }) => {
          run.landed(hit.cause, hit.receipt);
          return [];
        },
        "player-hits-settled": ({ player: hp }) => (settings.practice() && script.outcome.kind === "running" && hp.hp <= 0 ? [{ kind: "heal", amount: hp.maxHp, limit: "max-hp" }] : []),
        "player-moved": () => undefined,
        "tick-ended": ({ inputs, combatDraws }) => ({ row: run.close(combatDraws, inputs), ending: null }),
      };
      binding = host.bind(tick(0), hooks);
      region.addMob(boss);
      const views = new P1Views(region, { boss, player }, settings.hazardTiles, options.say);
      const bound = binding;
      watch.mounted = { boss, views, arena, script, now: () => run.now, started: () => bound.rows.length > 0 };
      return {
        frame: identity({ width: GRID, height: GRID }),
        rules: {
          judge: () => ({ outcome: "passed" }),
          hpFloor: () => script.hpFloor(),
          walk: () => ({ kind: "sdk" }),
          canAttack: () => true,
          lineOfSight: () => "sdk",
        },
        ready() {},
        openTick: () => bound.openTick(),
        finishTick: () => {
          const row = bound.finishTick();
          if (!row) return;
          views.present(row);
          options.told(row.tick, cueChanges(row.events));
          options.warned(row.tick, threatChanges(row.events));
        },
        rows: () => bound.rows,
        leave() {
          run.leave();
          views.dispose();
          arena.dispose();
          region.removeMob(boss);
          if (player.aggro === boss) player.setAggro(null);
          watch.mounted = null;
        },
      };
    },
  };
}
