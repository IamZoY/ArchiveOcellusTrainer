import { Settings, TrainerInstance, Viewport } from "osrs-sdk";
import type { ScriptEvent } from "../../../sim/script";
import type { ATile } from "../fight/geometry";
import { FightPlayer } from "../fight/units";
import type { FullFightOptions } from "../full/region";
import { FightRegion } from "../full/region";
import type { P1Cause, P1Event, P1Look, P1Row, P1Types } from "../full/p1/types";

export type P1RunOptions = Readonly<{ seed?: number; practice?: boolean; hazardTiles?: boolean; prayerGuide?: boolean; mechanicsGuide?: boolean }>;

/** The full fight's own region started at phase 1, as `?mode=full&phase=1` starts it, ticked by hand. */
export function startP1(options: P1RunOptions = {}) {
  Settings.readFromStorage();
  const fight: FullFightOptions = {
    seed: options.seed ?? 1,
    party: 1,
    startPhase: 1,
    hazardTiles: options.hazardTiles ?? true,
    videoMarkers: false,
    prayerGuide: options.prayerGuide ?? false,
    mechanicsGuide: options.mechanicsGuide ?? false,
    skipMarkers: false,
    patternMarkers: false,
    soloVine: true,
    invincible: options.practice ?? true,
    defenceDrained: false,
  };
  const region = new FightRegion(fight, () => undefined);
  const trainer = new TrainerInstance(region, { force2d: true });
  trainer.mount(document.createElement("canvas"), document.createElement("div"));
  region.world.getReadyTimer = 0;
  Viewport.viewport.resize(800, 600);

  const rows = (): readonly P1Row[] => region.rows("p1");
  const now = () => rows().at(-1)?.tick ?? -1;
  const live = () => {
    const mounted = region.p1.mounted;
    if (mounted === null) throw new Error("phase 1 is not running");
    return mounted;
  };
  const player = () => {
    const p = region.players[0];
    if (!(p instanceof FightPlayer)) throw new Error("the region has no full-fight player");
    return p;
  };
  const tickOnce = () => region.world.tickWorld();
  const tickTo = (t: number) => {
    for (let guard = 0; now() < t && region.current === "p1"; guard++) {
      if (guard > 400) throw new Error(`phase 1 stuck at tick ${now()}`);
      tickOnce();
    }
  };
  const here = (): ATile => player().arenaTile();
  const bossAt = (): ATile => live().boss.tile;
  const events = (): readonly (readonly [number, ScriptEvent<P1Types>])[] => rows().flatMap((row) => row.events.map((event) => [row.tick, event] as const));
  const ofKind = (kind: P1Event["kind"]): readonly (readonly [number, P1Event])[] =>
    events().flatMap(([t, event]) => (event.kind === kind ? [[t, event] as const] : []));
  const landed = (kind: P1Cause["kind"], from = 0) =>
    events().flatMap(([t, event]) => (event.kind === "hit-landed" && event.cause.kind === kind && t >= from ? [t] : []));
  const looks = <K extends P1Look["kind"]>(kind: K): readonly (readonly [number, Extract<P1Look, { kind: K }>])[] => {
    const isKind = (look: P1Look): look is Extract<P1Look, { kind: K }> => look.kind === kind;
    return events().flatMap(([t, event]) => (event.kind === "shown" && isKind(event.look) ? [[t, event.look] as const] : []));
  };
  return { region, trainer, live, player, rows, now, tickOnce, tickTo, here, bossAt, events, ofKind, landed, looks, close: () => trainer.dispose() };
}
