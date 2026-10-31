import type { TickSpan } from "../../../../sim/brands";
import { span } from "../../../../sim/brands";
import type { Selected } from "../../../../sim/sourced";
import { p2Sourced } from "../data/p2";

/** A tick count from his data, checked once here as the span the engine's timers take. */
function ticks(sourced: Selected<number>): Selected<TickSpan> {
  return { ...sourced, value: span(sourced.value) };
}

function tickList(sourced: Selected<readonly number[]>): Selected<readonly TickSpan[]> {
  return { ...sourced, value: sourced.value.map((n) => span(n)) };
}

const D = p2Sourced;

/** Phase 2's timings as engine spans. Every value and its evidence is his, from `full/data/p2.ts`. */
export const T = {
  oneTick: ticks(D.oneTick),
  repairEvery: ticks(D.repairEvery),
  shoutLasts: ticks(D.shoutLasts),
  portalsAt: ticks(D.portalsAt),
  bladeAt: ticks(D.bladeAt),
  rounds: tickList(D.rounds),
  enough: ticks(D.enough),
  p3At: ticks(D.p3At),
  lightEvery: ticks(D.lightEvery),
  fireAfterLight: ticks(D.fireAfterLight),
  poolsAt: ticks(D.poolsAt),
  poolsLast: ticks(D.poolsLast),
  allLitAt: ticks(D.allLitAt),
  safePortalAt: ticks(D.safePortalAt),
  safePortalUntil: ticks(D.safePortalUntil),
  allFireAt: ticks(D.allFireAt),
} as const;

/** One of the three gap sequences a round runs. */
export type GapSequence = (typeof D.gapOrder.value)[number];

/** Damage, counts and other values the script reads unconverted. */
export const V = D;
