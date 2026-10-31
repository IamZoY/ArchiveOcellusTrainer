import type { ClientCycles, TickSpan } from "../../../../sim/brands";
import { clientCycles, span } from "../../../../sim/brands";
import type { Selected } from "../../../../sim/sourced";
import { p3Sourced } from "../data/p3";

/** A tick count from his data, checked once here as the span the engine's timers take. */
function ticks(sourced: Selected<number>): Selected<TickSpan> {
  return { ...sourced, value: span(sourced.value) };
}

function cycles(sourced: Selected<number>): Selected<ClientCycles> {
  return { ...sourced, value: clientCycles(sourced.value) };
}

function tickList(sourced: Selected<readonly number[]>): Selected<readonly TickSpan[]> {
  return { ...sourced, value: sourced.value.map((n) => span(n)) };
}

const D = p3Sourced;
const U = D.untether;

/** Phase 3's timings as engine spans. Every value and its evidence is his, from `full/data/p3.ts`. */
export const T = {
  jumpToCornerAfter: ticks(D.jumpToCornerAfter),
  jump: ticks(D.jumpTicks),
  firstMove: ticks(D.firstMove),
  swingGap: ticks(D.swingGap),
  afterPanic: ticks(D.afterPanic),
  afterSlash: ticks(D.afterSlash),
  slashLands: ticks(D.slashLands),
  slashShowsBefore: ticks(D.slashShowsBefore),
  sawFirstCut: ticks(D.sawFirstCut),
  sawEvery: ticks(D.sawEvery),
  sawShowsBefore: ticks(D.sawShowsBefore),
  afterSpin: ticks(D.afterSpin),
  spinOpens: ticks(D.spinOpens),
  severTicks: ticks(D.severTicks),
  severBefore: ticks(D.severBefore),
  panicLands: ticks(D.panicLands),
  patchEvery: ticks(D.patchEvery),
  bombOverheadBefore: ticks(D.bombOverheadBefore),
  bombDropAfter: ticks(D.bombDropAfter),
  debrisIntoSpin: { first: ticks(D.debrisIntoSpin.first), later: ticks(D.debrisIntoSpin.later) },
  debrisFalls: ticks(D.debrisFalls),
  vineRootsAfter: ticks(D.vineRootsAfter),
  vineCutByTeammate: ticks(D.vineCutByTeammate),
  vineHolds: ticks(D.vineHolds),
  stoneJump: cycles(D.stoneJumpCycles),
  idleAfter: ticks(D.idleAfter),
  flyingMessageEvery: ticks(D.flyingMessageEvery),
  insolenceFirst: ticks(D.insolenceFirst),
  insolenceEvery: ticks(D.insolenceEvery),
  insolenceLands: ticks(D.insolenceLands),
  afterInsolence: ticks(D.afterInsolence),
  insolenceDebrisLasts: ticks(D.insolenceDebrisLasts),
  riftDetonatesAfter: ticks(D.riftDetonatesAfter),
  healRiftEvery: ticks(D.healRiftEvery),
  poseLoopAfter: ticks(D.poseLoopAfter),
  collapseBurstEvery: ticks(D.collapseBurstEvery),
  shoutLasts: { short: ticks(D.shoutLasts.short), long: ticks(D.shoutLasts.long) },
  riftsAfter: ticks(D.riftsAfter),
  riftEvery: ticks(D.riftEvery),
  segment: {
    first: { bombs: tickList(D.first.bombs) },
    later: { bombs: tickList(D.later.bombs) },
  },
  untether: {
    pools: tickList(U.pools),
    magic: tickList(U.magic),
    magicFlight: ticks(U.magicFlight),
    unleashVfx: ticks(U.unleashVfx),
    erupt: ticks(U.erupt),
    slam: ticks(U.slam),
    aftershock: ticks(U.aftershock),
    obliteration: ticks(U.obliteration),
    swingsAgain: ticks(U.swingsAgain),
    escapeLine: ticks(U.escapeLine),
    gone: ticks(U.gone),
    nextSegment: ticks(U.nextSegment),
  },
} as const;

/** Damage, counts and other values the script reads unconverted. */
export const V = D;
