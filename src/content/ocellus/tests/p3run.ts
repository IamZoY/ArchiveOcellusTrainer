import { Settings, TrainerInstance, Viewport } from "osrs-sdk";
import type { ScriptEvent } from "../../../sim/script";
import type { ATile, Body, Quadrant } from "../fight/geometry";
import { QUADRANTS, at, distanceToBody, quadrantOf, quadrantTiles } from "../fight/geometry";
import type { StartWeapon } from "../js/OcellusTimings";
import { dressFullFight } from "../fight/blowpipe";
import { FightPlayer } from "../fight/units";
import { P3 } from "../full/data/p3";
import type { StartPhase } from "../full/options";
import type { FullFightOptions } from "../full/prefix";
import { FightRegion } from "../full/prefix";
import type { P3Cause, P3Look, P3Row, P3Types } from "../full/p3/types";

export type P3RunOptions = Readonly<{ seed?: number; practice?: boolean; soloVine?: boolean; weapon?: StartWeapon | null; startPhase?: StartPhase; defenceDrained?: boolean; prayerGuide?: boolean; mechanicsGuide?: boolean }>;

/** The full fight's own region, ticked by hand. It starts at phase 3 unless `startPhase` says otherwise. */
export function startP3(options: P3RunOptions = {}) {
  Settings.readFromStorage();
  const fight: FullFightOptions = {
    seed: options.seed ?? 1,
    party: 1,
    startPhase: options.startPhase ?? 3,
    hazardTiles: true,
    videoMarkers: false,
    prayerGuide: options.prayerGuide ?? false,
    mechanicsGuide: options.mechanicsGuide ?? false,
    skipMarkers: false,
    patternMarkers: false,
    soloVine: options.soloVine ?? true,
    invincible: options.practice ?? true,
    defenceDrained: options.defenceDrained ?? false,
  };
  const region = new FightRegion(fight, (player) => {
    if (!options.weapon) return;
    dressFullFight(player, options.weapon);
  });
  const trainer = new TrainerInstance(region, { force2d: true });
  trainer.mount(document.createElement("canvas"), document.createElement("div"));
  region.world.getReadyTimer = 0;
  Viewport.viewport.resize(800, 600);

  const rows = (): readonly P3Row[] => region.rows("p3");
  const now = () => rows().at(-1)?.tick ?? -1;
  const live = () => {
    const mounted = region.p3.mounted;
    if (mounted === null) throw new Error("phase 3 is not running");
    return mounted;
  };
  const player = () => {
    const p = region.players[0];
    if (!(p instanceof FightPlayer)) throw new Error("the region has no full-fight player");
    return p;
  };
  const tickOnce = () => region.world.tickWorld();
  const tickTo = (t: number, each: () => void = () => undefined) => {
    for (let guard = 0; now() < t; guard++) {
      if (guard > 2000) throw new Error(`phase 3 stuck at tick ${now()}`);
      tickOnce();
      each();
    }
  };
  const body = (): Body => ({ sw: live().boss.tile, size: 3 });
  const here = (): ATile => player().arenaTile();
  /** Stand beside his 3x3, square on, so every swing reaches you. */
  const stayInReach = () => {
    const boss = live().boss;
    if (boss.hidden || distanceToBody(body(), here()) === 1) return;
    const sw = boss.tile;
    const sides: ATile[] = [at(sw.x - 1, sw.z + 1), at(sw.x + 3, sw.z + 1), at(sw.x + 1, sw.z - 1), at(sw.x + 1, sw.z + 3)];
    const side = sides.find((t) => live().arena.isWalkable(t));
    if (side) player().hop(side);
  };
  /** His HP at a whole-number percentage of the pool. */
  const bossAt = (percent: number) => {
    const boss = live().boss;
    boss.currentStats.hitpoint = Math.ceil((boss.stats.hitpoint * percent) / 100);
  };
  /** Off his quadrant onto another standing one, before it falls. */
  const stepOff = () => {
    const from = quadrantOf(here());
    const next = QUADRANTS.find((q) => q !== from && !live().arena.destroyed.has(q));
    if (!next) throw new Error("no quadrant left to stand on");
    standOn(next);
  };
  const standOn = (q: Quadrant): ATile => {
    const t = quadrantTiles(q).find((tileIn) => live().arena.isWalkable(tileIn));
    if (!t) throw new Error(`no floor in ${q}`);
    player().hop(t);
    return t;
  };
  const events = (): readonly (readonly [number, ScriptEvent<P3Types>])[] => rows().flatMap((row) => row.events.map((event) => [row.tick, event] as const));
  const anims = (from: number, ids: readonly number[]) =>
    events().flatMap(([t, e]) => (e.kind === "boss-changed" && e.change.kind === "animation" && t >= from && ids.includes(e.change.id) ? [[t - from, e.change.id] as const] : []));
  const said = (text: string, from: number) => events().flatMap(([t, e]) => (e.kind === "boss-changed" && e.change.kind === "said" && e.change.text === text ? [t - from] : []));
  const landed = (kinds: readonly P3Cause["kind"][], from = 0) => events().flatMap(([t, e]) => (e.kind === "hit-landed" && kinds.includes(e.cause.kind) && t >= from ? [[t - from, e.cause.kind] as const] : []));
  const looks = <K extends P3Look["kind"]>(kind: K): readonly (readonly [number, Extract<P3Look, { kind: K }>])[] => {
    const isKind = (look: P3Look): look is Extract<P3Look, { kind: K }> => look.kind === kind;
    return events().flatMap(([t, e]) => (e.kind === "shown" && isKind(e.look) ? [[t, e.look] as const] : []));
  };
  const chat = (text: string, from = 0) => looks("chat").flatMap(([t, look]) => (look.text === text ? [t - from] : []));
  return { region, trainer, live, player, rows, now, tickOnce, tickTo, body, here, stayInReach, bossAt, stepOff, standOn, events, anims, said, landed, looks, chat, close: () => trainer.dispose() };
}

/** Phase 3 begins on tick 0 and he lands in his first corner P3.jumpToCornerAfter later: the segment start S. */
export const S = P3.jumpToCornerAfter;
