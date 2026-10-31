import type { ResolvedChoices, SpecialSelection, TransitionRecipe, VoidRecipe } from "../OcellusTimings";
import { OCELLUS_P4 } from "../OcellusTimings";
import type { Cycle, Seed, Tick, TickSpan } from "../../../../sim/brands";
import { cycle, tick } from "../../../../sim/brands";
import type { BeatAt, Script, Slot } from "../../../../sim/schedule";
import { Schedule, slotTable } from "../../../../sim/schedule";
import type { Sourced } from "../../../../sim/sourced";
import { minus } from "../../../../sim/sourced";
import type { Beat, BossOverhead, Mechanic, Phase, Special, TransitionKind, VoidKind } from "../P4Types";
import { ordinal } from "../P4Types";
import { floorRule } from "./floor";
import { roll } from "../roll";

export type P4Schedule = Schedule<"lead-in" | "cycle", Phase, Beat, Mechanic>;

const VARIANTS: readonly Special[] = ["vortex", "spike-disk", "black-disk"];

/** Ticks from a transition attack's tell to its hit. The schedule puts the hit here, and the prayer guide counts it down. */
export function specialLead(kind: TransitionKind): Sourced<TickSpan> {
  const [, afterInner, , afterOuter] = OCELLUS_P4.cycle;
  const recipe = kind === "after-inner" ? afterInner : afterOuter;
  return minus(recipe.hitAfterStart, recipe.tellAfterStart);
}

function specialFor(selection: SpecialSelection, nth: number, seed: Seed, hitAt: Tick): Special {
  const uniform = (): Special => VARIANTS[Math.floor(roll(seed, "specialVariant", hitAt, 0) * VARIANTS.length)];
  switch (selection.kind) {
    case "random-uniform":
      return uniform();
    case "rotation":
      return selection.order[nth % selection.order.length];
    case "replay":
      return nth < selection.order.length ? selection.order[nth] : uniform();
    default: {
      const unhandled: never = selection;
      return unhandled;
    }
  }
}

function mechanicOf(beat: Beat): Mechanic | null {
  switch (beat.kind) {
    case "boss-shouts":
    case "boss-landing-starts":
      return null;
    case "lifeforce-tell":
    case "lifeforce-hit":
    case "orb-matures":
    case "orb-expires":
    case "unclaimed-orb-heals":
      return "lifeforce-orb";
    case "explosion-series-starts":
    case "explosion-mark":
    case "explosion-impact":
    case "explosions-occurring":
      return "explosions";
    case "floor-damage":
      return "void-floor";
    case "special-tell":
    case "special-hit":
    case "special-sound":
    case "soul-split-heal":
      return "transition-attacks";
    case "rifts-spawn":
    case "rift-charge-ends":
      return "rifts";
    default: {
      const unhandled: never = beat;
      return unhandled;
    }
  }
}

export function compileSchedule(seed: Seed, choices: ResolvedChoices): P4Schedule {
  const { leadIn, cycle: stages, overheads, lifeforce, special, bossHeals, rifts, explosion: explosionCues, presentation } = OCELLUS_P4;
  const hidden = leadIn.hiddenFor.value;
  const leadInLength = hidden + leadIn.presentFor.value;
  const shout = leadIn.shout.value;
  if (shout.at >= leadInLength) throw new RangeError(`lead-in shout at ${shout.at} is outside the ${leadInLength}-tick lead-in`);
  const shoutBeat: Beat = { kind: "boss-shouts", text: shout.text, lasts: shout.lasts };
  const leadInSlots = Array.from({ length: leadInLength }, (_, t): Slot<Phase, Beat> => {
    const phase: Phase = { stage: "lead-in", boss: t < hidden ? "hidden" : leadIn.presentBoss.value, overhead: null };
    return { phase: () => phase, beats: t === shout.at ? [() => shoutBeat] : [] };
  });

  const [inner, afterInner, outer, afterOuter] = stages;
  const afterInnerStart = inner.duration.value;
  const outerStart = afterInnerStart + afterInner.duration.value;
  const afterOuterStart = outerStart + outer.duration.value;
  const length = afterOuterStart + afterOuter.duration.value;
  const beats: BeatAt<Beat>[][] = Array.from({ length }, () => []);
  const put = (offset: number, label: string, beat: BeatAt<Beat>) => {
    if (offset < 0 || offset >= length) throw new RangeError(`${label} at cycle offset ${offset} is outside the ${length}-tick cycle`);
    beats[offset].push(beat);
  };
  const inside = (offset: number, duration: number, label: string) => {
    if (offset >= duration) throw new RangeError(`${label} at ${offset} is outside its ${duration}-tick stage`);
  };

  const explosions = choices.explosions.option.value;
  const unclaimed = choices.unclaimedOuterOrb.option.value;
  const voidBeats = (recipe: VoidRecipe<VoidKind>, start: number) => {
    const { kind } = recipe;
    inside(lifeforce.hitAfterOnset.value, recipe.duration.value, `${kind} lifeforce hit`);
    const hit = start + lifeforce.hitAfterOnset.value;
    put(start + lifeforce.tellAfterOnset.value, `${kind} lifeforce tell`, () => ({ kind: "lifeforce-tell", void: kind }));
    put(hit, `${kind} lifeforce hit`, () => ({ kind: "lifeforce-hit", void: kind }));
    put(hit + recipe.orbMaturesAfterHit.value, `${kind} orb maturity`, () => ({ kind: "orb-matures", void: kind }));
    const expiry = start + recipe.duration.value + recipe.orbLingersAfterClear.value;
    put(expiry, `${kind} orb expiry`, () => ({ kind: "orb-expires", void: kind }));
    if (kind === "outer-void" && unclaimed.kind === "heals-boss") {
      if (hit + unclaimed.afterHit <= expiry) throw new RangeError(`an unclaimed outer orb must heal the boss after it expires at ${expiry}, not at ${hit + unclaimed.afterHit}`);
      put(hit + unclaimed.afterHit, "unclaimed outer orb heal", () => ({ kind: "unclaimed-orb-heals" }));
    }
    put(hit + explosionCues.seriesStartsAfterHit.value, `${kind} explosion series start`, () => ({ kind: "explosion-series-starts", void: kind }));
    const firstMark = hit + explosions.firstMarkAfterHit;
    for (let pulse = 0; pulse < explosions.count; pulse++) {
      const mark = firstMark + pulse * explosions.period;
      put(mark, `${kind} explosion mark ${pulse}`, () => ({ kind: "explosion-mark", void: kind, pulse }));
      put(mark + explosions.impactAfterMark, `${kind} explosion impact ${pulse}`, () => ({ kind: "explosion-impact", void: kind, pulse }));
    }
    const lastImpact = firstMark + (explosions.count - 1) * explosions.period + explosions.impactAfterMark;
    for (let offset = firstMark; offset <= lastImpact; offset++) {
      put(offset, `${kind} explosions occurring`, () => ({ kind: "explosions-occurring", void: kind }));
    }
    const floor = floorRule(kind, choices);
    if (floor.kind === "damages") {
      inside(floor.afterOnset, recipe.duration.value, `${kind} floor damage onset`);
      for (let offset = floor.afterOnset; offset < recipe.duration.value; offset++) {
        put(start + offset, `${kind} floor damage`, () => ({ kind: "floor-damage", void: kind }));
      }
    }
  };

  const selection = choices.specialSelection.option.value;
  const transitionBeats = (recipe: TransitionRecipe<TransitionKind>, start: number) => {
    const { kind, duration, tellAfterStart, hitAfterStart, soulSplitAfterTell } = recipe;
    inside(tellAfterStart.value + soulSplitAfterTell.value, duration.value, `${kind} Soul Split`);
    inside(hitAfterStart.value, duration.value, `${kind} transition hit`);
    const nth = (c: Cycle) => ordinal(2 * (c - 1) + (kind === "after-inner" ? 0 : 1));
    const variant = (c: Cycle, cycleStart: Tick) => specialFor(selection, nth(c), seed, tick(cycleStart + start + hitAfterStart.value));
    put(start + tellAfterStart.value, `${kind} transition tell`, (c, s) => ({ kind: "special-tell", ordinal: nth(c), variant: variant(c, s) }));
    put(start + tellAfterStart.value + specialLead(kind).value, `${kind} transition hit`, (c, s) => ({ kind: "special-hit", ordinal: nth(c), variant: variant(c, s) }));
    put(start + hitAfterStart.value + bossHeals.soulSplitAfterHit.value, `${kind} Soul Split heal`, (c) => ({ kind: "soul-split-heal", ordinal: nth(c) }));
    for (const told of VARIANTS) {
      for (const { value: cue } of special.cues[special.styles[told].value]) {
        inside(tellAfterStart.value + cue.afterTell, duration.value, `${kind} ${cue.sound}`);
        put(start + tellAfterStart.value + cue.afterTell, `${kind} ${cue.sound}`, (c, s) => (variant(c, s) === told ? { kind: "special-sound", ordinal: nth(c), cue } : null));
      }
    }
  };

  voidBeats(inner, 0);
  put(afterInnerStart - presentation.landingBeforeInnerClears.value, "boss landing", () => ({ kind: "boss-landing-starts" }));
  transitionBeats(afterInner, afterInnerStart);
  voidBeats(outer, outerStart);
  transitionBeats(afterOuter, afterOuterStart);

  const firstRiftCycle = rifts.firstCycle.value;
  if (firstRiftCycle < 2) throw new RangeError(`rifts cannot spawn before cycle 1 starts (first rift cycle ${firstRiftCycle})`);
  const riftSpawn = length - rifts.spawnBeforeOnset.value;
  put(riftSpawn, "rift spawn", (c) => (c + 1 >= firstRiftCycle ? { kind: "rifts-spawn", forCycle: cycle(c + 1) } : null));
  put(riftSpawn + rifts.chargeAfterSpawn.value - length, "rift charge", (c) => (c >= firstRiftCycle ? { kind: "rift-charge-ends", forCycle: c } : null));

  const overheadAfter = <D extends BossOverhead>(recipe: TransitionRecipe<TransitionKind>, sinceStart: number, deflect: D): D | "soul-split" | null => {
    if (sinceStart >= recipe.duration.value - overheads.offBeforeVoid.value) return null;
    return sinceStart < recipe.tellAfterStart.value + recipe.soulSplitAfterTell.value ? deflect : overheads.transition.value;
  };
  const phaseAt = (offset: number) => (c: Cycle): Phase => {
    if (offset < afterInnerStart) {
      return { stage: "inner-void", cycle: c, boss: choices.hoverMeleeReach.option.value, overhead: overheads["inner-void"].value };
    }
    if (offset < outerStart) {
      return { stage: "after-inner", cycle: c, boss: "present-damageable", overhead: overheadAfter(afterInner, offset - afterInnerStart, overheads["inner-void"].value) };
    }
    if (offset < afterOuterStart) {
      return { stage: "outer-void", cycle: c, boss: "present-damageable", overhead: overheads["outer-void"].value };
    }
    return { stage: "after-outer", cycle: c, boss: "present-damageable", overhead: overheadAfter(afterOuter, offset - afterOuterStart, overheads["outer-void"].value) };
  };

  const cycleSlots = beats.map((slotBeats, offset): Slot<Phase, Beat> => ({ phase: phaseAt(offset), beats: slotBeats }));
  const script: Script<"lead-in" | "cycle", Phase, Beat> = {
    first: "lead-in",
    stages: {
      "lead-in": { slots: slotTable(leadInSlots, "lead-in"), breakable: false, then: () => "cycle" },
      cycle: { slots: slotTable(cycleSlots, "cycle"), breakable: false, then: () => "cycle" },
    },
    breakpoints: [],
  };
  const firstRiftCycleEnds = tick(leadInLength + length * firstRiftCycle);
  return new Schedule(script, mechanicOf, choices.focus.option.value, choices.drillStart.option.value, firstRiftCycleEnds);
}
