import { Settings, TrainerInstance, Viewport } from "osrs-sdk";
import type { ScriptEvent } from "../../../sim/script";
import type { ATile } from "../fight/geometry";
import { FightPlayer } from "../fight/units";
import type { FullFightOptions } from "../full/prefix";
import { FightRegion } from "../full/prefix";
import type { P2Cause, P2Event, P2Look, P2Row, P2Types } from "../full/p2/types";

export type P2RunOptions = Readonly<{ seed?: number; practice?: boolean; hazardTiles?: boolean; skipMarkers?: boolean; patternMarkers?: boolean }>;

/** The full fight's own region started at phase 2, as `?mode=full&phase=2` starts it, ticked by hand. */
export function startP2(options: P2RunOptions = {}) {
  Settings.readFromStorage();
  const fight: FullFightOptions = {
    seed: options.seed ?? 1,
    party: 1,
    startPhase: 2,
    hazardTiles: options.hazardTiles ?? true,
    videoMarkers: false, prayerGuide: false, mechanicsGuide: false,
    skipMarkers: options.skipMarkers ?? false,
    patternMarkers: options.patternMarkers ?? false,
    soloVine: true,
    invincible: options.practice ?? true,
    defenceDrained: false,
  };
  const region = new FightRegion(fight, () => undefined);
  const trainer = new TrainerInstance(region, { force2d: true });
  trainer.mount(document.createElement("canvas"), document.createElement("div"));
  region.world.getReadyTimer = 0;
  Viewport.viewport.resize(800, 600);

  const rows = (): readonly P2Row[] => region.rows("p2");
  const now = () => rows().at(-1)?.tick ?? -1;
  const live = () => {
    const mounted = region.p2.mounted;
    if (mounted === null) throw new Error("phase 2 is not running");
    return mounted;
  };
  const player = () => {
    const p = region.players[0];
    if (!(p instanceof FightPlayer)) throw new Error("the region has no full-fight player");
    return p;
  };
  const tickOnce = () => region.world.tickWorld();
  const tickTo = (t: number) => {
    for (let guard = 0; now() < t && region.current === "p2"; guard++) {
      if (guard > 400) throw new Error(`phase 2 stuck at tick ${now()}`);
      tickOnce();
    }
  };
  const here = (): ATile => player().arenaTile();
  const events = (): readonly (readonly [number, ScriptEvent<P2Types>])[] => rows().flatMap((row) => row.events.map((event) => [row.tick, event] as const));
  const ofKind = (kind: P2Event["kind"]): readonly (readonly [number, P2Event])[] =>
    events().flatMap(([t, event]) => (event.kind === kind ? [[t, event] as const] : []));
  const landed = (kind: P2Cause["kind"], from = 0) =>
    events().flatMap(([t, event]) => (event.kind === "hit-landed" && event.cause.kind === kind && t >= from ? [t] : []));
  const looks = <K extends P2Look["kind"]>(kind: K): readonly (readonly [number, Extract<P2Look, { kind: K }>])[] => {
    const isKind = (look: P2Look): look is Extract<P2Look, { kind: K }> => look.kind === kind;
    return events().flatMap(([t, event]) => (event.kind === "shown" && isKind(event.look) ? [[t, event.look] as const] : []));
  };
  return { region, trainer, live, player, rows, now, tickOnce, tickTo, here, events, ofKind, landed, looks, close: () => trainer.dispose() };
}
