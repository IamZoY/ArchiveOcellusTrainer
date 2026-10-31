import { after } from "../../../../sim/brands";
import type { CueChange, Foretold } from "../../../../sim/prayerCue";
import { OCELLUS_P4 } from "../OcellusTimings";
import type { Phase, Special, TickRow, TransitionKind } from "../P4Types";
import { specialLead } from "./schedule";

/** What the prayer guide names for each transition attack. The pictures are the tells in `OCELLUS_P4.presentation.transitionTells`. */
const SPECIAL_TELL: Readonly<Record<Special, Readonly<{ attack: string; tell: string }>>> = {
  "black-disk": { attack: "black disk", tell: "purple semicircle, then a black disk over his footprint (melee transition attack)" },
  "spike-disk": { attack: "spike disk", tell: "dark disk with purple spikes reaching toward you (ranged transition attack)" },
  vortex: { attack: "vortex", tell: "purple starburst, then a purple-rimmed ring around him (magic transition attack)" },
};

function foretold(variant: Special): Foretold {
  return { style: OCELLUS_P4.special.styles[variant].value, ...SPECIAL_TELL[variant], caution: null, on: { kind: "boss" } };
}

/** The transition a tell falls in. A tell only ever falls in one; the voids have none. */
function transitionOf(phase: Phase): TransitionKind | null {
  switch (phase.stage) {
    case "after-inner":
    case "after-outer":
      return phase.stage;
    case "lead-in":
    case "inner-void":
    case "outer-void":
      return null;
    default: {
      const unhandled: never = phase;
      return unhandled;
    }
  }
}

/** Each transition attack told on this row, landing `specialLead` ticks on, where the schedule puts its hit. */
export function specialCues(row: TickRow): readonly CueChange[] {
  const transition = transitionOf(row.phase);
  if (transition === null) return [];
  const lead = specialLead(transition).value;
  return row.events.flatMap((event): CueChange[] =>
    event.kind === "special-told" ? [{ kind: "told", cue: { ...foretold(event.variant), id: event.ordinal, told: event.at, lands: after(event.at, lead) } }] : [],
  );
}
