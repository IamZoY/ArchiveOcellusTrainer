import { Unit } from "osrs-sdk";
import type { Player } from "osrs-sdk";
import { tick } from "../../../../../sim/brands";
import type { Tick } from "../../../../../sim/brands";
import type { CueChange } from "../../../../../sim/prayerCue";
import type { ThreatChange } from "../../../../../sim/threat";
import type { AttackTarget, Enter, Entries, Mounted, PhaseDef } from "../../../../../sim/encounter";
import { identity } from "../../../../../sim/frame";
import type { BossChange } from "../../../../../sim/script";
import { ScriptRun, cueChanges, threatChanges } from "../../../../../sim/script";
import type { EncounterBinding, Hooks } from "../../../../../sim/sdk/EncounterBinding";
import type { PlayerInput } from "../../../../../sim/sdk/EncounterPlayer";
import type { EncounterHost } from "../../../../../sim/sdk/EncounterRegion";
import type { FloorState } from "../../../fight/arena";
import { GRID, MIDDLE, fromSdk } from "../../../fight/geometry";
import type { ATile } from "../../../fight/geometry";
import { FightPlayer, VoidAdd } from "../../../fight/units";
import { scaledHp } from "../../data/looks";
import { P2 } from "../../data/p2";
import { P3Script } from "../script";
import { P3Dangers } from "../threats";
import type { Fall, P3Cause, P3Entry, P3Row, P3Types } from "../types";
import { Arena } from "./arena";
import { P3Boss } from "./boss";
import type { ChatLine } from "./views";
import { P3Views } from "./views";

type P3Encounter = Readonly<{ input: PlayerInput; event: never; cause: P3Cause; snapshot: null; row: P3Row; end: never }>;

/** The sidebar's toggles: practice, "attack your own vine", the danger-tile highlights, and whether his Defence opens drained. */
export type P3Settings = Readonly<{ practice: () => boolean; soloVine: () => boolean; hazardTiles: () => boolean; defenceDrained: () => boolean }>;

export type P3Mount = Readonly<{ boss: P3Boss; views: P3Views; arena: Arena; script: P3Script<Entries>; now: () => number; started: () => boolean }>;
/** The page's hold on the running P3: the boss bar, chat and probe read it. */
export type P3Watch = { mounted: P3Mount | null };

export type P3Options<E extends Entries> = Readonly<{
  settings: P3Settings;
  watch: P3Watch;
  /** Whoever draws the arena floor shows this phase's while it runs, and stops when it leaves. */
  showFloor: (state: () => FloorState) => () => void;
  /** Where the third fall leads, or null when this run ends with phase 3. */
  fallInto: (fall: Fall) => Enter<E> | null;
  /** The chatbox outlives the phase, so its lines go to whoever keeps it. */
  say: (line: ChatLine) => void;
  /** The prayer guide takes each closed row's cue changes, on this phase's clock. */
  told: (now: Tick, changes: readonly CueChange[]) => void;
  /** The mechanics guide takes each closed row's warnings, on this phase's clock. */
  warned: (now: Tick, changes: readonly ThreatChange<ATile>[]) => void;
}>;

/** The vine roots you on its own tile, and the SDK will not let you attack what you stand under. Solo, you cut it from there. */
function vineGrant(target: AttackTarget, player: Player): "sdk" | "granted" {
  if (!(target instanceof VoidAdd) || target.kind !== "vine" || !target.attackable) return "sdk";
  return target.location.x === player.location.x && target.location.y === player.location.y ? "granted" : "sdk";
}

function applied(boss: P3Boss, player: Player, change: BossChange<P3Types>): void {
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
      boss.jump(change.to, change.over);
      return;
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

/** Phase 3 written as closures, on the run's one player and in the full fight's arena. */
export function p3Phase<E extends Entries & Readonly<{ p3: P3Entry }>>(options: P3Options<E>): PhaseDef<E, "p3", P3Row, EncounterHost<E>> {
  const { settings, watch } = options;
  return {
    name: "p3",
    enter(host, entry): Mounted<P3Row> {
      const { region, player } = host;
      if (!(player instanceof FightPlayer)) throw new Error("phase 3 runs on the full fight's player");
      const poolMax = scaledHp(P2.hp, 1);
      let binding: EncounterBinding<P3Encounter> | null = null;
      const boss = new P3Boss(
        region,
        MIDDLE,
        {
          allowsDeath: () => false,
          afterHits: (form) => {
            form.currentStats.hitpoint = Math.max(form.currentStats.hitpoint, script.hpFloor(poolMax));
          },
          acceptsAttack: (form, style) => !(style === "melee" && form.overhead === "protect-melee"),
          incomingDamageFactor: () => 1,
          defenceDrained: settings.defenceDrained,
        },
        poolMax,
        (actor, resolve) => {
          if (binding === null) resolve();
          else binding.npcTurn(actor, resolve);
        },
      );
      boss.currentStats.hitpoint = entry.kind === "carried" ? entry.boss.hp : poolMax;
      const arena = new Arena(region, player, { practice: settings.practice, soloVine: settings.soloVine, maxNextHit: () => boss.grantMaxDamageRollsOnNextIncomingAttack() });
      const script: P3Script<E> = new P3Script<E>(arena, entry, (m, fall) => {
        const to = options.fallInto(fall);
        if (to !== null) m.next(to);
      });
      const run = new ScriptRun<E, P3Types>(
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
            player.currentStats.hitpoint = Math.min(player.stats.hitpoint, player.currentStats.hitpoint + amount);
          },
          next: (to) => host.next(to),
        },
        tick(0),
      );
      const hooks: Hooks<P3Encounter> = {
        "tick-opened": ({ time }) => run.open(time.encounter, time.world),
        "before-npc-hits": () => ({ snapshot: null, outputs: [] }),
        "npc-turn": () => ({ outputs: run.requested().map(({ cause, damage }) => ({ kind: "hit", damage, cause })), ending: null }),
        "hit-applied": ({ hit }) => {
          run.landed(hit.cause, hit.receipt);
          return [];
        },
        "player-hits-settled": ({ player: hp }) => (settings.practice() && script.current.kind !== "over" && hp.hp <= 0 ? [{ kind: "heal", amount: hp.maxHp, limit: "max-hp" }] : []),
        "player-moved": () => undefined,
        "tick-ended": ({ inputs, combatDraws }) => ({ row: run.close(combatDraws, inputs), ending: null }),
      };
      binding = host.bind(tick(0), hooks);
      region.addMob(boss);
      region.setBoss(boss);
      const dangers = new P3Dangers();
      const views = new P3Views(region, { boss: () => boss, player, addAt: (t) => arena.unitAt(t) }, settings.hazardTiles, options.say);
      const hideFloor = options.showFloor(() => arena.floorState());
      const bound = binding;
      watch.mounted = { boss, views, arena, script, now: () => run.now, started: () => bound.rows.length > 0 };
      return {
        frame: identity({ width: GRID, height: GRID }),
        rules: {
          judge: () => ({ outcome: "passed" }),
          hpFloor: () => script.hpFloor(poolMax),
          walk: (to) => (script.interceptWalk(fromSdk(to)) ? { kind: "handled" } : { kind: "sdk" }),
          canAttack: (target, style) => target instanceof Unit && script.playerAttacking(target === boss, style),
          lineOfSight: (target) => vineGrant(target, player),
        },
        ready() {},
        openTick: () => bound.openTick(),
        finishTick: () => {
          const row = bound.finishTick();
          if (!row) return;
          views.present(row);
          options.told(row.tick, cueChanges(row.events));
          options.warned(row.tick, [...threatChanges(row.events), ...dangers.read(row)]);
        },
        rows: () => bound.rows,
        leave() {
          run.leave();
          views.dispose();
          arena.dispose();
          hideFloor();
          region.removeMob(boss);
          if (player.aggro === boss || player.aggro instanceof VoidAdd) player.setAggro(null);
          watch.mounted = null;
        },
      };
    },
  };
}
