import type { Tick, Tile } from "../../../../sim/brands";
import { PROTECTION_PRAYER } from "../../../../sim/prayerCue";
import type { Moment } from "../../../../sim/schedule";
import type { Threat, Warning } from "../../../../sim/threat";
import { OCELLUS_P4 } from "../OcellusTimings";
import type { Beat, Phase, Stage, TickRow, VoidKind } from "../P4Types";

/** An explosion's marked tile, logged when it is marked: its impact comes on the schedule's `explosion-impact` beat. */
export type Marked = Readonly<{ void: VoidKind; pulse: number; tile: Tile }>;

const NOWHERE = { kind: "none" } as const;
const VOID_NAME: Readonly<Record<VoidKind, string>> = { "inner-void": "inner", "outer-void": "outer" };
const FLOOR_TODO: Readonly<Record<VoidKind, string>> = {
  "inner-void": "Stand outside the 5x5 around him",
  "outer-void": "Stand in the 5x5 under him",
};
const STAGE_NAME: Readonly<Record<Stage, string>> = {
  "lead-in": "He rises",
  "inner-void": "Inner void floods the 5x5 around him",
  "after-inner": "Inner void clears: transition",
  "outer-void": "Outer void floods the floor",
  "after-outer": "Outer void clears: transition",
};

/** The marks a row adds, so an explosion's impact can name its tile. */
export function markedOn(row: TickRow): readonly Marked[] {
  return row.events.flatMap((event) => (event.kind === "explosion-marked" ? [{ void: event.void, pulse: event.pulse, tile: event.tile }] : []));
}

/** What the guide says for one beat on the schedule, or null for a beat that is only part of another (sounds, the per-tick shards). */
function warningOf(beat: Beat, marked: readonly Marked[], untold: ReadonlySet<number>): Warning<Tile> | null {
  switch (beat.kind) {
    case "boss-shouts":
      return { what: `"${beat.text}"`, todo: "The phase 4 cycle starts from this shout", tone: "beat", where: NOWHERE };
    case "boss-landing-starts":
      return { what: "He lands", todo: "The inner void is about to clear", tone: "beat", where: NOWHERE };
    case "lifeforce-tell":
      return { what: `Lifeforce tell (${VOID_NAME[beat.void]} void)`, todo: "The steal hits next tick", tone: "beat", where: { kind: "spot", at: { kind: "player" } } };
    case "lifeforce-hit":
      return { what: "Lifeforce steal", todo: "Your stolen HP forms an orb: take it back once it's ripe", tone: "harm", where: { kind: "spot", at: { kind: "player" } } };
    case "orb-matures":
      return { what: `Orb ripe (${VOID_NAME[beat.void]} void)`, todo: "Walk over the orb to take your HP back", tone: "beat", where: NOWHERE };
    case "orb-expires":
      return { what: `Last orb pickup (${VOID_NAME[beat.void]} void)`, todo: "The orb is gone after this tick", tone: "beat", where: NOWHERE };
    case "unclaimed-orb-heals":
      return { what: "Unclaimed outer orb heals him", todo: "Take the outer orb before this", tone: "heal", where: NOWHERE };
    case "explosion-series-starts":
      return { what: "Explosion shards start", todo: "Each mark lands on your tile: keep stepping off", tone: "beat", where: NOWHERE };
    case "explosion-mark":
      return { what: `Explosion mark ${beat.pulse + 1}`, todo: "A shard marks the tile you stand on", tone: "beat", where: { kind: "spot", at: { kind: "player" } } };
    case "explosion-impact": {
      const mark = marked.find((each) => each.void === beat.void && each.pulse === beat.pulse);
      return { what: `Explosion ${beat.pulse + 1}`, todo: "Be off the marked tile", tone: "harm", where: mark ? { kind: "tiles", tiles: [mark.tile] } : NOWHERE };
    }
    case "floor-damage":
      return { what: `The ${VOID_NAME[beat.void]} void floor hurts`, todo: FLOOR_TODO[beat.void], tone: "harm", where: NOWHERE };
    case "special-tell":
      return { what: "Void blast tell", todo: "Read it: a black disk is melee, purple spikes ranged, a starburst magic", tone: "beat", where: { kind: "spot", at: { kind: "boss" } } };
    case "special-hit": {
      // In game its style is not known until its tell, so the guide does not say it sooner.
      if (untold.has(beat.ordinal)) return { what: "Void blast", todo: "Its tell shows which prayer", tone: "harm", where: { kind: "spot", at: { kind: "boss" } } };
      const style = OCELLUS_P4.special.styles[beat.variant].value;
      return { what: `Void blast (${style})`, todo: PROTECTION_PRAYER[style], tone: "harm", where: { kind: "spot", at: { kind: "boss" } } };
    }
    case "soul-split-heal":
      return { what: "Soul Split heals him", todo: "By what the blast took: pray right to deny it", tone: "heal", where: NOWHERE };
    case "rifts-spawn":
      return { what: "Void rifts spawn", todo: "Kill them before they burst", tone: "beat", where: NOWHERE };
    case "rift-charge-ends":
      return { what: "Void rifts burst", todo: "Any rift still alive hits you", tone: "harm", where: NOWHERE };
    case "explosions-occurring":
    case "special-sound":
      return null;
    default: {
      const unhandled: never = beat;
      return unhandled;
    }
  }
}

/** A beat repeated every tick (the floor) is told once, on its first tick in the window. */
function keyOf(beat: Beat): string {
  return beat.kind === "floor-damage" ? `${beat.kind}-${beat.void}` : JSON.stringify(beat);
}

/**
 * Every mechanic due in the window, read off the schedule P4 itself runs: each beat that lands, each stage change, and each
 * explosion on the tile its mark fell on. `from` is P4's tick now; the moments are the ticks after it.
 */
export function p4Threats(from: Tick, now: Phase, moments: readonly Moment<Phase, Beat>[], marked: readonly Marked[]): readonly Threat<Tile>[] {
  const threats: Threat<Tile>[] = [];
  const seen = new Set<string>();
  const untold = new Set(moments.flatMap((moment) => moment.beats.flatMap((beat): number[] => (beat.kind === "special-tell" ? [beat.ordinal] : []))));
  let stage = now.stage;
  for (const moment of moments) {
    if (moment.phase.stage !== stage) {
      stage = moment.phase.stage;
      threats.push({ what: STAGE_NAME[stage], todo: "", tone: "beat", where: NOWHERE, id: `stage-${moment.tick}`, told: from, lands: moment.tick });
    }
    for (const beat of moment.beats) {
      const key = keyOf(beat);
      if (beat.kind === "floor-damage" && seen.has(key)) continue;
      seen.add(key);
      const warning = warningOf(beat, marked, untold);
      if (warning) threats.push({ ...warning, id: `${beat.kind}-${moment.tick}-${threats.length}`, told: from, lands: moment.tick });
    }
  }
  return threats;
}
