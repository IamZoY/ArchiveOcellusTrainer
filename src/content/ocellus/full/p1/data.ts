import type { TickSpan } from "../../../../sim/brands";
import { span } from "../../../../sim/brands";
import type { DamageRange, Selected } from "../../../../sim/sourced";
import { p1Sourced } from "../data/p1";

/** A tick count from his data, checked once here as the span the engine's timers take. */
function ticks(sourced: Selected<number>): Selected<TickSpan> {
  return { ...sourced, value: span(sourced.value) };
}

function tickList(sourced: Selected<readonly number[]>): Selected<readonly TickSpan[]> {
  return { ...sourced, value: sourced.value.map((n) => span(n)) };
}

const D = p1Sourced;

/** Phase 1's timings as engine spans. Every value and its evidence is his, from `full/data/p1.ts`. */
export const T = {
  oneTick: ticks(D.oneTick),
  introLasts: ticks(D.introLasts),
  cornerShoutLasts: ticks(D.cornerShoutLasts),
  startWalkAfter: ticks(D.startWalkAfter),
  volleyEvery: ticks(D.volleyEvery),
  volleyNear: ticks(D.volleyLand.near),
  volleyFar: ticks(D.volleyLand.far),
  chargeAfterArriving: ticks(D.chargeAfterArriving),
  linesEvery: ticks(D.linesEvery),
  lineClosesAfter: ticks(D.lineClosesAfter),
  chargeVfxFrom: ticks(D.chargeVfxFrom),
  chargeVfxEvery: ticks(D.chargeVfxEvery),
  shoutAt: ticks(D.shoutAt),
  explodeAt: ticks(D.explodeAt),
  blastAt: ticks(D.blastAt),
  walkOnAt: ticks(D.walkOnAt),
  teleportInAfter: ticks(D.teleportInAfter),
  firstBeatAfter: ticks(D.firstBeatAfter),
  beatEvery: ticks(D.beatEvery),
  beatLineCloses: tickList(D.beatLineCloses),
  beatExplodeAfter: ticks(D.beatExplodeAfter),
  beatChargeAt: ticks(D.beatChargeAt),
  strikeShoutAfterLastExplode: ticks(D.strikeShoutAfterLastExplode),
  strikeHitAfterShout: ticks(D.strikeHitAfterShout),
  walkOnAfterShout: ticks(D.walkOnAfterShout),
  transformAtMiddleAfter: ticks(D.transformAtMiddleAfter),
  endingTeleportAfter: ticks(D.endingTeleportAfter),
  endingLandAfter: ticks(D.endingLandAfter),
  endingTransformAfterLanding: ticks(D.endingTransformAfterLanding),
  p2After: ticks(D.p2After),
} as const;

/** Damage, counts and other values the script reads unconverted. */
export const V = D;

/** An inclusive roll range that keeps the evidence of the number it was counted from. */
export function upTo(basis: Selected<number>, maxInclusive: number): Selected<DamageRange> {
  return { kind: "selected", value: { min: 0, max: maxInclusive }, evidence: basis.evidence };
}
