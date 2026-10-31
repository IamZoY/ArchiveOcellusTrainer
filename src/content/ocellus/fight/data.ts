/**
 * Every id, timing and damage range the full fight uses, in one place.
 *
 * Sources (see docs/SOURCES.md):
 *  [R] RSProx tick analysis of six recorded fights, MRobertEvers/oldschool-clientc
 *      docs/rsprox-analysis/guthixian_archive/ocellus_plan.md (2026-10-21)
 *  [W] OSRS Wiki, Ocellus and The Fractured Archive/Strategies (2026-10-21)
 *  [G] RuneLite gameval AnimationID / SpotanimID / NpcID (cache 241)
 *  [V] ShadowStalkerTM, "Duo The Fractured Archive", youtube.com/watch?v=HAgq_qg0OIY (12:17 kill)
 *  [K] a RuneLite fight log of a spectated 8-raider kill, 2026-10-23: every anim, floor
 *      spotanim and projectile, every raider's hitsplats with their overhead, and positions around Untether, by tick
 * Ticks are 600 ms game ticks unless marked cc (20 ms client cycles).
 */

export type Range = Readonly<{ min: number; max: number }>;
const range = (min: number, max: number): Range => ({ min, max });

/** [G] NpcID */
export const NPC = {
  hoodedFigure: 16673,
  p1: 16674,
  p2: 16675,
  blade: 16676,
  p3: 16677,
  riftBasic: 16678,
  riftHeal: 16679,
  riftBuff: 16680,
  vine: 16681,
} as const;

/** [G] AnimationID (seq) */
export const SEQ = {
  p1Idle: 14804,
  p1Walk: 14805,
  p1VolleyStart: 14806,
  p1VolleyEnd: 14807,
  p1Charge: 14809,
  p1Expend: 14810,
  p1Explode: 14811,
  p1TeleportOut: 14812,
  p1TeleportIn: 14813,
  p1Transformation: 14814,
  p2Transformation: 14837,
  p2Idle: 14839,
  p2ToP3Part1: 14878,
  p2ToP3Part2: 14881,
  p3Idle: 14840,
  p3IdleHigh: 14841,
  p3MeleeBasic: 14842,
  p3MeleeHybrid: 14844,
  p3MeleePrayer: 14845,
  p3MeleeSlash: 14846,
  p3SuperiorSlash: 14848,
  p3Walk: 14849,
  p3ProjectileAll: 14851,
  p3SoulFragmentStart: 14855,
  p3SoulFragmentEnd: 14856,
  p3UnleashIn: 14857,
  p3UnleashLoop: 14858,
  p3QuadrantDestroyIn: 14859,
  p3QuadrantDestroyLoop: 14860,
  p3UnleashOut: 14861,
  p3UnleashOut90: 14862,
  p3DeflectIn: 14863,
  p3DeflectLoop: 14864,
  p3DeflectOut: 14865,
  p3PrayerIn: 14869,
  p3PrayerLoop: 14870,
  p3PrayerOut: 14871,
  p3Death: 14872,
  /** HUMAN_YAMA_SHORTJUMP01, the player's jump onto and off each stepping stone */
  humanYamaShortJump: 12196,
  /**
   * Each rift's four sequences, in the cache's order after its stand animation (npc 16678-16680 stand on 14895, 14899
   * and 14903): idle, spawn (1 tick), despawn (1 tick) and detonate (2 ticks). The rift models are effects, so without
   * them they sit in their bind pose, a thin sliver.
   */
  riftBasicIdle: 14895,
  riftBasicSpawn: 14896,
  riftBasicDespawn: 14897,
  riftBasicDetonate: 14898,
  riftHealIdle: 14899,
  riftHealSpawn: 14900,
  riftHealDespawn: 14901,
  riftHealDetonate: 14902,
  riftBuffIdle: 14903,
  riftBuffSpawn: 14904,
  riftBuffDespawn: 14905,
  riftBuffDetonate: 14906,
} as const;

/**
 * [G] ObjectID tfa_ocellus_quadrant_wall_inactive (62684) and _active (62685), phase 2's portals. Read from cache 2746:
 * one model each, both looping seq 14830 (vfx_ocellus_p2_portal_idle), 2x1 tiles.
 */
export const PORTAL = {
  inactiveModel: 62758,
  activeModel: 62757,
  idle: 14830,
} as const;

/**
 * [G] ObjectID phase 3's floor hazards, read from cache 2746 (each a 1x1 loc with a type 10 and a type 22 model):
 * tfa_ocellus_void_degen_bomb "Void" (62701), _void_degen_aoe "Debris" (62702), _aoe_insolence_1 "Cracks" (62703).
 */
export const VOID_LOC = {
  bomb: { models: [62507, 62508], idle: 14891 },
  aoe: { models: [62687, 62688], idle: 14936 },
  insolence: { models: [62682, 62683], idle: 14930 },
} as const;
export type VoidLocKind = keyof typeof VOID_LOC;

/** [G] SpotanimID */
export const SPOT = {
  fireOnBoss: 4231,
  fireProjectile: 4232,
  fireImpact: 4233,
  waterOnBoss: 4228,
  waterProjectile: 4229,
  waterImpact: 4230,
  expendProjectile: 4234,
  strikeProjectile: 4235,
  crackStraightStart: [4236, 4237, 4238, 4239],
  crackStraight: [4240, 4242, 4244, 4246],
  crackStraightEnd: [4241, 4243, 4245, 4247],
  crackDiagonalStart: [4248, 4249, 4250, 4251],
  crackDiagonal: [4252, 4254, 4256, 4258],
  crackDiagonalEnd: [4253, 4255, 4257, 4259],
  p1Charge: 4260,
  p1ExplodeOnBoss: 4261,
  p1ExplodeFloor: [4262, 4263, 4264, 4265],
  p1TeleportOut: 4266,
  p1TeleportIn: 4267,
  p1ToP2: 4268,
  portalProjectile: 4269,
  p2Pool: 4270,
  safePortalSpawn: 4271,
  safePortalIdle: 4272,
  safePortalDespawn: 4273,
  death: 4274,
  deathSkirt: 4275,
  deathCrack: 4276,
  swordIdle: 4278,
  swordIdle2: 4279,
  swordDrop: 4280,
  swordRootFire: 4281,
  p2ToP3Arm: 4282,
  p2ToP3ArmGlow: 4283,
  entangleStart: 4290,
  entangleIdle: 4291,
  entangleEnd: 4292,
  magicImpact: 4293,
  magicOnBoss: 4294,
  magicProjectile: 4297,
  bombIdle: 4299,
  bombImpact: 4300,
  bombDrop: 4301,
  bombSpawn: 4302,
  healingFlare: 4303,
  swordRepair: 4304,
  swordDischarge: 4305,
  soulFragmentSpawn6: 4309,
  soulFragmentIdle: 4310,
  soulFragmentSpawn12: 4311,
  soulFragmentDespawn: 4312,
  soulFragmentPlayer: 4313,
  soulFragmentRegain: 4314,
  levitating: 4316,
  unleashArena: [4317, 4318, 4319, 4320],
  unleashOnBoss: 4321,
  deflectWind: 4322,
  slashDegen: 4323,
  meleePrayerIn: 4325,
  meleePrayer: 4326,
  meleePrayerOut: 4327,
  hybridMelee: 4328,
  hybridMagic: 4329,
  hybridRanged: 4330,
  collapseIn: 4331,
  collapseLoop: 4332,
  collapseOut1: 4333,
  collapseOut2: 4334,
  shadowSlash: 4335,
  superiorSlash: 4336,
  voidChainExplosion: 4339,
  voidChainTelegraph: 4340,
  glowZaros: 4341,
  glowBandos: 4342,
  glowSaradomin: 4343,
  glowArmadyl: 4344,
  fallingDebris: 4346,
  debrisIdle: 4347,
  swordDropExplosion: 4388,
  collapsingExplosion: [4390, 4391, 4392, 4393],
} as const;

/** Sounds the server sends on its own (the rest ride on the seqs and spotanims above). */
export const SOUND = {
  crackClosed: [12512, 12513],
  swordDischarge: 4428,
  swordDropBoom: 444,
  heal: 5281,
  explosionSeriesStart: 12638,
  explosionMark: 12537,
  meleeTell: 12572,
  meleeHit: 12567,
  rangedBeforeHit: 12555,
  rangedHit: 12556,
  magicWindUp: 12554,
} as const;

/**
 * The 21 October hotfix: Defence reduction stops at 60% of his level (phase 1: 129 of 215, phase 3: 150 of 250);
 * The Blade has no floor. [W] Out Today news and The Fractured Archive/Strategies, via ArchiveOcellusTrainer #17;
 * rounding up is inferred.
 */
export const LOWEST_DEFENCE_FRACTION = 0.6;

/** [R] RAID_PLAN.md: HP = base x multiplier, rounded to 10. Solo uses the duo scale. */
export const PARTY_SCALE: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 1.45, 4: 1.87, 5: 2.29 };
export const scaledHp = (base: number, party: number): number => Math.round((base * (PARTY_SCALE[party] ?? 1)) / 10) * 10;

export const P1 = {
  hp: 2500,
  combatLevel: 1121,
  /** Phase 1 holds Protect from Melee while walking. [R] */
  defence: 215,
  defenceBonuses: { stab: 150, slash: 95, crush: 60, magic: 100, range: 135 },
  startWalkAfter: 4,
  volleyEvery: 5,
  /** A shot flies 65 cc to a raider within 4 of his middle tile (3 of his body), 95 cc beyond: 735 of 735 in ten raid logs. */
  volleyLand: { near: 3, far: 4, nearWithin: 3 },
  volleyDamage: range(1, 25),
  elementSwitchChance: 14 / 65,
  /** Corner script, from the charge C. [R] */
  linesEvery: 2,
  lineCount: 7,
  lineClosesAfter: 5,
  chargeVfxFrom: 5,
  shoutAt: 15,
  explodeAt: 18,
  blastAt: 19,
  walkOnAt: 21,
  shouts: ["Pointless...", "You... fail...", "Unworthy..."],
  blastRadius: 2,
  /** 25-35 on 41 raiders within 2 of him, ten raid logs. */
  blastDamage: range(25, 35),
  /** A closing crack hits every raider 3-5, on it or not: 1,745 hits on close ticks to 65 off them in five logs. */
  closeChip: range(3, 5),
  /** An unblocked crack heals him, and fills the meter, floor(8 / party) per raider off it: ten raid logs. Solo: 8. */
  meterPerLine: 8,
  healPerLine: 8,
  meterMax: 96,
  /** Middle phase at 66% and a quarter. [R] */
  thresholds: [0.66, 0.25],
  teleportInAfter: 4,
  firstBeatAfter: 8,
  beatEvery: 8,
  beats: 4,
  beatLineLength: 6,
  /**
   * A beat's two lines appear together on the beat tick; the first in turn order closes after 4, the other after 6
   * ([K] second kill: 4258 and 4252 at +36, closing at +40 and +42). Corner cracks close after 5.
   */
  beatLineCloses: [4, 6],
  beatExplodeAfter: 6,
  strikeShoutAfterLastExplode: 2,
  strikeHitAfterShout: 3,
  strikeDamage: range(17, 19),
  /** One more shot per 24 of meter: 22 gave 1 shot, 27, 30 and 44 gave 2, 58 gave 3, ten raid logs. */
  meterPerExtraShot: 24,
  /**
   * After the strike's "Death... awaits..." his first volley comes 9 ticks on: 11 of 11 strikes in fight logs L1, L3 to
   * L8 (e.g. L1.txt "Death... awaits..." at P1 +139, anim 14806 at +148), and 2 of 2 in a 2026-10-30 raid log.
   */
  walkOnAfterShout: 9,
  /** Next corner: anticlockwise 10, clockwise 3, across 6 of 19 recorded [R], and 25, 3, 8 of 36 in ten raid logs. */
  routeWeights: { anticlockwise: 35, clockwise: 6, across: 14 },
  cornerLineLength: 9,
  /**
   * From "You... will disappear...": in the middle he transforms 3 on; elsewhere he teleports 2 on, lands 3 later and
   * transforms 2 after. Phase 2 opens 7 after the transformation: 10 of 10 raid logs.
   */
  transformAtMiddleAfter: 3,
  endingTeleportAfter: 2,
  endingLandAfter: 3,
  endingTransformAfterLanding: 2,
  p2After: 7,
  /** The shortest wait a timer accepts. */
  oneTick: 1,
  /** The opening element, and which tendril leads a corner. His phase 1 rolled a coin for each. */
  coin: 1 / 2,
  /** A side tendril runs straight this often. His phase 1 used 62/107. */
  straightChance: 62 / 107,
  /** A corner tendril: diagonal below the first, the near side below the second, otherwise the other, out of the last. */
  cornerTendrilDiagonal: 20,
  cornerTendrilSide: 31,
  cornerTendrilOutOf: 42,
  /** Overhead text. The intro, a strike and the ending hold this long. A corner shout holds the shorter one. */
  introLasts: 4,
  cornerShoutLasts: 3,
  /** The charge follows the arriving volley by this many ticks. Already standing at the corner, it is one tick. */
  chargeAfterArriving: 6,
  /** Charge graphics from chargeVfxFrom until the explosion, this often. */
  chargeVfxEvery: 2,
  /** The charge graphic in the middle of a beat, before that beat's explosion. */
  beatChargeAt: 4,
} as const;

export const P2 = {
  hp: 5250,
  bladeDefence: 250,
  bladeDefenceBonuses: { stab: 150, slash: 120, crush: 10, magic: 100, range: 110 },
  portalsAt: 2,
  bladeAt: 7,
  rounds: [11, 53, 95],
  enough: 123,
  wallsFall: 127,
  p3At: 131,
  /** Within a round R: [R] */
  lightEvery: 5,
  lightTimes: 6,
  fireAfterLight: 4,
  poolsAt: 28,
  poolCount: 13,
  allLitAt: 31,
  safePortalAt: 33,
  safePortalUntil: 39,
  allFireAt: 40,
  lineDamage: range(19, 25),
  /**
   * A volley lands on the tile d out from its portal at speed x d - speed client cycles (30 to a tick): 6 for the
   * lit portals, 5 for the all-twelve volley. [R] Each tile is judged on the tick the volley is over it, so running
   * through the wave skips it, as with the Wardens' skulls in Tombs of Amascut. [O] J R V's "Ocellus P2 Portal Skip"
   * (youtube c4PSUxjNUiY): stand 6 out diagonally, click 4 out one tick before the volley.
   */
  lineCyclesPerTile: 6,
  crossfireCyclesPerTile: 5,
  /** The skip's tiles, out along each quadrant's diagonal. A deeper pink than the RuneLite markers' #F5B1F7, which an
   * outline alone loses on the pale floor. */
  skipStandOut: 6,
  skipRunOut: 4,
  skipMarkerColour: "#FF3DE0",
  poolDamage: range(3, 5),
  /**
   * A round's six gaps are one of three fixed sequences, each wave's (north or south arm, east or west arm) gap 1..6
   * out, mirrored into every quadrant. The first round's sequence is random, then orange, red, green in turn (39/39
   * rounds in 13 fights). [R]
   */
  gapSequences: {
    orange: [[2, 2], [4, 2], [2, 4], [2, 2], [3, 3], [5, 2]],
    red: [[3, 3], [3, 4], [2, 5], [3, 3], [3, 5], [4, 4]],
    green: [[2, 1], [2, 4], [2, 6], [4, 4], [3, 3], [4, 1]],
  },
  /** The order the rounds run the sequences in, from a random first. [R] */
  gapOrder: ["orange", "red", "green"],
  /** One tick, for a beat that follows another by a tick. */
  oneTick: 1,
  /** The sword's repair graphic: first at tick 3, then every 3 until enough. */
  repairEvery: 3,
  /** How many ticks an overhead line stays up. */
  shoutLasts: 4,
} as const;

const NO_TICKS: readonly number[] = [];

export const P3 = {
  combatLevel: 1601,
  defence: 250,
  defenceBonuses: { stab: 150, slash: 100, crush: 30, magic: 200, range: 250 },
  jumpToCornerAfter: 6,
  /**
   * His attacks are a chain, each move timed from the one before, not a clock from the segment start. Two swings 3
   * ticks apart, the shadow slash 3 after the second, and his next move 4 after the slash. After two such sets comes a
   * special. With nobody in his reach a purple magic shot (anim 14851, no shout) takes a swing's place, and the next move comes 6 ticks
   * after it, so the rest of the chain runs 3 ticks late. [K], which reproduces [R]'s fixed segment timelines.
   */
  firstMove: 4,
  swingGap: 3,
  afterPanic: 6,
  afterSlash: 4,
  setsPerSpecial: 2,
  /**
   * His specials, the same in eight recorded fights: the spin alternates with another special through the whole phase,
   * carrying on across quadrant falls. The other one alternates Untether and Insolence within a quadrant, Untether first
   * in the first quadrant and Insolence first in later ones. His HP plays no part (Untether at 91%, 85%, 63%). [K]
   * e.g. S U S I S U S I S | fall | I S U S I ... and S U S I | fall | S I S U S | fall | I S U ...
   * On the segment's own clock from its start S: void bombs (when they drop) and the rifts. [R] [K]
   */
  first: { firstOther: "untether", bombs: [6, 9], rifts: NO_TICKS },
  later: { firstOther: "insolence", bombs: [6], rifts: [3, 51, 111] },
  /** Swings hit everyone near him on the animation tick: 1-7 through Protect from Melee. [R] [K] */
  basicHitProtected: range(1, 7),
  basicHitUnprotected: range(12, 19),
  /**
   * The shadow slash lands the tick after its animation, on a band aimed at his tank (solo: you) and snapped to the
   * nearest of 8 directions from his middle tile: 3 wide from the ring touching his body to the platform's edge. [K]
   * 111 bands in six fights
   */
  slashLands: 1,
  slashDamage: range(25, 28),
  /** Insolence's bands: 3 wide, to the platform edge, at any angle. [V] duo 20:24, Bubba OSRS guide 4:56 [W] [K] */
  waveWidth: 3,
  /**
   * The spin: saw i cuts 5 + 3i ticks in, on the tick its loop animation (the last saw's: the end animation) plays; an
   * overhead up on the tick before is severed. His next move comes 4 ticks after the last cut. [K] [V]
   */
  sawFirstCut: 5,
  sawEvery: 3,
  /** Each saw's spotanim (4326, the last saw's 4327) shows on him 2 ticks before its cut. Every spin in fight logs L2, L6 to L8. */
  sawShowsBefore: 2,
  afterSpin: 4,
  spinDamage: range(15, 27),
  /** A melee hit on everyone 1 tick into the spin, 0 through Protect from Melee. Every spin in fight logs L1 to L8. */
  spinOpens: 1,
  spinOpeningDamage: range(0, 18),
  /**
   * "Severing your prayer!" locks protection prayers for the tick after the sever only: a prayer clicked then is
   * refused, the next click works. Fight log L6 P3 +563 sever, +564 "You've been injured and can't use that prayer!",
   * Protect from Melee back on every raider at +565; L4 t8712 sever, t8713 refused. With the sdk applying clicks before
   * the count, 1 refuses the click on the cut tick and takes the one after.
   */
  severTicks: 1,
  /** The overhead severed is the one up on the tick before each cut. ocellus-sim phase3.ts:351 */
  severBefore: 1,
  panicLands: 2,
  volleyDamage: range(20, 26),
  patchDamage: range(6, 7),
  /** A void hurts whoever stands on it every second tick from the tick it dropped. */
  patchEvery: 2,
  patchLasts: range(21, 51),
  /**
   * Void bombs fall on every raider but the tank (solo: you), and on the same tile turned into each other standing
   * quadrant. Their voids stay until the quadrant falls, so the last quadrant's carry into phase 4. [R] [M] 8:55
   * Each shows over its raider first (spotanim 4302 5 ticks before it drops, 4299 a tick later), then on its floor
   * tile (4299) 2 ticks before it drops. [K]; every bombed segment in fight logs L2, L6 to L8
   */
  bombOverheadBefore: 5,
  bombDropAfter: 2,
  bombDamage: range(6, 11),
  /**
   * Rubble over each raider during the spin, 3 ticks in (first segment) or 6 (later); it falls 5 ticks on and leaves
   * a void patch. [R] [M] 7:20. The damage is a guess (nobody stood under it in [R]): the bomb's.
   */
  debrisIntoSpin: { first: 3, later: 6 },
  debrisFalls: 5,
  debrisDamage: range(6, 11),
  vineHp: 44,
  /**
   * A vine shout ("The void... will take you...", "Await... the void..." or "Your panic... is futile...") comes with his first move after a quadrant's 1st and 3rd spins (13 of 15 first
   * spins and 5 of 5 third ones in eight fights; never an even one, rarely a later odd one), and the vine roots its
   * target where they stand 3 ticks later. [K]
   */
  vineAfterSpins: [1, 3],
  vineRootsAfter: 3,
  /**
   * It holds its target until it dies: vines lived 7-32 ticks, median 14, and nobody took a hit for leaving one ([K];
   * [R] and [W] had 14 ticks, then 50). With "attack your own vine" off, a teammate cuts yours at the median.
   */
  vineCutByTeammate: 14,
  /**
   * "Insolence...": superior slashes animate 2, 7 and 12 ticks on, each landing 3 after its animation, and his swings
   * resume 20 ticks after the shout. [K] Damage: [R] 39-41, [K] 38, 43 and 46.
   */
  insolenceFirst: 2,
  insolenceSlashes: 3,
  insolenceEvery: 5,
  insolenceLands: 3,
  afterInsolence: 20,
  insolenceDamage: range(38, 46),
  insolenceDebrisLasts: 16,
  riftHp: 44,
  /**
   * A rift left alive detonates 30 ticks after it appears (its detonate animation, a flare on raiders and a hit on the
   * same tick; gone 2 later), in all 3 of [K]'s unkilled rifts; 56 others died to raiders 4-30 ticks in. Phase 3's
   * hits: 39 (a Void Rift) and 40, 40, 41 (a Void Augmenter); one raider took 18 under Protect from Magic. [K]
   */
  riftDetonatesAfter: 30,
  riftDetonationDamage: range(39, 41),
  /** Killing a Void Augmenter: Attack and Strength to 116, Magic and Ranged to 112, from 99s. [W] Void Augmenter */
  augmenterBoost: { melee: 17, rangedMagic: 13 },
  /** Killing a Void Siphon gives its killer 22 health, half its 44. [W] https://oldschool.runescape.wiki/w/Void_Siphon */
  siphonHeal: 22,
  healRiftEvery: 4,
  healRiftHeal: [12, 14],
  /** Untether, from U. [R] [W] [K] */
  untether: {
    /**
     * Pools (spotanim 4270) splash in waves; from the second, one lands under each raider as the magic hits them. They
     * never hit: through all 15 Untethers in fight logs L1, L2, L6 to L8, raiders take hits only on the magic's ticks.
     */
    pools: [6, 10, 14, 18],
    poolsPerWave: range(10, 15),
    /**
     * Magic at everyone lands with each pool wave after the first: "pray mage, he'll mage you constantly" [M] 4:37;
     * zeros through Protect from Magic on every raider in [K] and [R].
     */
    magic: [10, 14, 18, 22],
    magicFlight: 2,
    magicDamage: range(20, 28),
    unleashVfx: 18,
    /** The arena flares under him. No hit comes with it. [K] */
    erupt: 25,
    /**
     * The slam hits whoever is not under his 3x3 at the end of the tick before it; the aftershock a tick later hits
     * whoever is still under him. So be under him by the end of U+28 and one tile out at the end of U+29. [K]: 36 on the
     * one raider outside, then 21 and 41 on the two still under. [M] 5:00: "step out is tick perfect".
     */
    slam: 29,
    slamDamage: range(34, 39),
    aftershock: 30,
    aftershockDamage: range(18, 41),
    obliteration: 31,
    /** With his HP above the floor the quadrant stands and his swings resume. [K] */
    swingsAgain: 37,
    escapeLine: 42,
    gone: 44,
    nextSegment: 48,
  },
  /**
   * The quadrant falls the tick after his whole-number HP% is down to 75 / 50 / 25 (the sim holds him there), Untether
   * or not, cutting short whatever he is doing ([K] 23:03: "Obliteration..." on the tick of a set's slash). His bar
   * reads the same at the floor and just above it, so the tick the floor came is not on the record. During Untether it
   * waits for U+31. [W] [O] [V] [K]
   */
  hpFloors: [0.75, 0.5, 0.25],
  jumpTicks: 2,
  shoutLasts: {
    /** Untether, panic, Insolence and the escape line stay over his head 3 ticks. ocellus-sim phase3.ts:380, 501, 593, 715 */
    short: 3,
    /** The vine's and the fall's shouts stay 4 ticks. ocellus-sim phase3.ts:452, 699 */
    long: 4,
  },
  /**
   * He says either of his two fall shouts evenly. ocellus-sim phase3.ts:699. His vine shouts are three: "Your panic...
   * is futile..." is one, a vine 3 ticks after it in every case (L3 +1028, L4 +566, L6 +39, L7 +39, twice in a
   * 2026-10-30 raid log), never with his magic shot (anim 14851 has no shout in L1, L7, L8). ocellus-sim phase3.ts:452
   */
  shoutChance: 0.5,
  /** His Untether and fall loops take over 2 ticks into their opening animations. ocellus-sim phase3.ts:602, 704 */
  poseLoopAfter: 2,
  /** The collapsing quadrant bursts every 2 ticks, 4 bursts at a time, until it falls. ocellus-sim phase3.ts:709-711 */
  collapseBurstEvery: 2,
  collapseBursts: 4,
  /** The spin's hits reach 8 tiles from his south-west tile. ocellus-sim phase3.ts:362 */
  spinReach: 8,
  /** The shadow slash's band shows a tick before his animation, the last tick to click out of it. ocellus-sim phase3.ts:253 */
  slashShowsBefore: 1,
  /** The vine's hold, renewed on every tick it lives. ocellus-sim phase3.ts:469, 772 */
  vineHolds: 2,
  /**
   * [R] Each stone jump draws over 27 cc, inside its 30 cc tick, so the next jump starts on the next tick: "Jump (op1)
   * from the bank onto the near stone, stone to stone, off the far stone onto the bank it is named for;
   * `human_yama_shortjump01`, a teleport and a 27-cycle exact move (4301 [1327..1338]: four hops a raider)"
   */
  stoneJumpCycles: 27,
  /** The vine's grip and the over-head bomb each turn to their idle look a tick after they start. ocellus-sim phase3.ts:471; [K] 4302 then 4299 a tick later */
  idleAfter: 1,
  /** "It's flying too high to hit using melee." shows at most once in this many ticks. ocellus-sim phase3.ts:935 */
  flyingMessageEvery: 3,
  /** A rift spawns at least 2 tiles clear of his body. ocellus-sim phase3.ts:538 */
  riftClearance: 2,
  censer: {
    /** The Zarosian censer gives 50 special energy. ocellus-sim phase3.ts:893 */
    special: 50,
    /** Special energy stops at 100. ocellus-sim phase3.ts:893 */
    specialMax: 100,
    /** The Saradomin censer gives 50 hitpoints, past your maximum. ocellus-sim phase3.ts:896 */
    hitpoints: 50,
    /** The Saradomin censer gives 50 prayer, up to your maximum. ocellus-sim phase3.ts:897 */
    prayer: 50,
  },
  practiceRefill: {
    /** Practice refills hitpoints that fall under 30 and are not 0. ocellus-sim Fight.ts:169 */
    hitpoints: 30,
    /** Practice refills prayer that falls under 10. ocellus-sim Fight.ts:172 */
    prayer: 10,
  },
} as const;

export type BossOverhead = "protect-melee" | "deflect-melee" | "deflect-range" | "soul-split";

/** [G] His Protect from Melee overhead: sprite 440 (headicons_prayer), frame 0. */
export const PROTECT_MELEE_ICON = { archive: 440, frame: 0 } as const;
