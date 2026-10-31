import type { EquipmentSlot, LoadoutIds, TwistedBow } from "osrs-sdk";
import type { Cycle, Seed, SoundId, TickSpan, Tile } from "../../../sim/brands";
import { cycle, seed, soundId, span, tick, tile } from "../../../sim/brands";
import type { Style } from "../../../sim/combat";
import type { Basis, Citations, Evidence, WikiRef } from "../../../sim/provenance";
import { noWiki, wiki } from "../../../sim/provenance";
import type { DrillStart, Focus } from "../../../sim/schedule";
import type { BossOverhead, HoveringBoss, Mechanic, Special, Stage, TransitionKind, VoidKind } from "./P4Types";
import { roll } from "./roll";

type Scale = "unscaled" | "team-4" | "team-5" | "team-4-and-5" | "team-7" | "team-8" | "team-7-and-8" | "solo";

const VODS = {
  V1: { streamer: "Molgoatkirby", url: "https://www.twitch.tv/videos/2906214879", tickPrefix: "G", clipTickAtP4Zero: 25 },
  V2: { streamer: "Molgoatkirby", url: "https://www.twitch.tv/videos/2906214879", tickPrefix: "k", clipTickAtP4Zero: 40 },
} as const;
type Vod = keyof typeof VODS;

/**
 * RuneLite fight logs recorded on 2026-10-23, in recording order: the game's animations, spotanims, projectiles, hitsplats
 * and NPC spawns by tick, as seen by one client. A cite's `at` counts ticks from S, the tick his Deflect rise (seq 14863)
 * starts a phase 4 cycle, or names the phase and its own marks.
 */
export type FightLog = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8";
type FightLogEntry = Readonly<{ recorded: "2026-10-23"; fight: "spectated kill" | "raid"; players: number; reached: string; records: string }>;
const FIGHT_LOGS: Readonly<Record<FightLog, FightLogEntry>> = {
  L1: { recorded: "2026-10-23", fight: "spectated kill", players: 8, reached: "the kill", records: "every boss animation, shout and floor graphic, his projectiles, each player's hitsplats with the overhead they had up, the boss's hitsplats and HP, player positions through each Untether and each phase 2 volley" },
  L2: { recorded: "2026-10-23", fight: "spectated kill", players: 8, reached: "the kill", records: "as L1, plus the spotanims on the boss and on every player, NPC spawns, and each player's position and overhead on every tick of each spin" },
  L3: { recorded: "2026-10-23", fight: "raid", players: 4, reached: "a wipe in phase 3's first quadrant", records: "by a player in the raid, with ticks counted from entering the arena and no phase marks: the boss's animations with his facing, floor graphics, projectiles, the spotanims on the boss and the players, each player's hitsplats with their overhead, NPC spawns and the chat" },
  L4: { recorded: "2026-10-23", fight: "raid", players: 7, reached: "a wipe in phase 3, after two quadrants fell", records: "as L3" },
  L5: { recorded: "2026-10-23", fight: "raid", players: 7, reached: "a wipe in phase 4's third cycle", records: "as L3" },
  L6: { recorded: "2026-10-23", fight: "raid", players: 7, reached: "a wipe in phase 4's fifth cycle", records: "by a player in the raid, with phase marks: as L2, plus that player's own hitsplats with their type and prayer, the floor graphics the game sent that player, its own lifeforce orbs among them, and where it stepped into the 5x5" },
  L7: { recorded: "2026-10-23", fight: "raid", players: 7, reached: "a wipe in phase 3, after two quadrants fell", records: "as L6" },
  L8: { recorded: "2026-10-23", fight: "raid", players: 7, reached: "a wipe in phase 3, after one quadrant fell", records: "as L6" },
};

type OwnerDate = "2026-10-21" | "2026-10-22" | "2026-10-23" | "2026-10-24" | "2026-10-25" | "2026-10-27" | "2026-10-28" | "2026-10-30";

export type Source =
  | Readonly<{ kind: "fight-log"; log: FightLog; at: string }>
  | Readonly<{ kind: "analysis"; url: string; at: string }>
  | Readonly<{ kind: "vod"; vod: Vod; at: string }>
  | Readonly<{ kind: "news"; url: string }>
  | Readonly<{ kind: "cache"; build: 2746; record: string }>
  | Readonly<{ kind: "owner"; date: OwnerDate; topic: string }>
  | Readonly<{ kind: "guide"; url: string; at: string }>
  | Readonly<{ kind: "ocellus-sim"; commit: "75bd193"; at: string }>
  | Readonly<{ kind: "gameval"; commit: "7715a1d2"; name: string }>;

export type Selected<T> = Readonly<{ kind: "selected"; value: T; evidence: Evidence<Source, Scale> }>;

export function selected<T>(value: T, basis: Basis, scale: Scale, note: string, ...sources: Citations<Source>): Selected<T> {
  return {
    kind: "selected",
    value,
    evidence: { status: "unverified", basis, scale, note: process.env.NODE_ENV === "production" ? "" : note, sources },
  };
}

type Options = Readonly<Record<string, Selected<unknown>>>;
type Choice<O extends Options> = Readonly<{ default: keyof O & string; options: Readonly<O> }>;
function choice<O extends Options>(defaultKey: keyof O & string, options: O): Choice<O> {
  return { default: defaultKey, options };
}

export const fightLog = (log: FightLog, at: string): Source => ({ kind: "fight-log", log, at });
/** A written analysis of packet captures, such as the RSProx notes on the raid. */
export const analysis = (url: string, at: string): Source => ({ kind: "analysis", url, at });
const vod = (which: Vod, at: string): Source => ({ kind: "vod", vod: which, at });
const news = (url: string): Source => ({ kind: "news", url });
export const cache = (record: string): Source => ({ kind: "cache", build: 2746, record });
const owner = (topic: string, date: OwnerDate = "2026-10-21"): Source => ({ kind: "owner", date, topic });
export const guide = (url: string, at: string): Source => ({ kind: "guide", url, at });
/** A constant in RuneLite's gameval tables, which carry Jagex's own names for cache ids. */
const gameval = (name: string): Source => ({ kind: "gameval", commit: "7715a1d2", name });
/** Alessandro Rodi's ocellus-sim, github.com/alessandrorodi/ocellus-sim; its ids are read, never its code copied. */
const ocellusSim = (at: string): Source => ({ kind: "ocellus-sim", commit: "75bd193", at });
const STRATEGIES_P4 = wiki("https://oldschool.runescape.wiki/w/The_Fractured_Archive/Strategies", 15381030);
const BOSS_INFOBOX = wiki("https://oldschool.runescape.wiki/w/Ocellus", 15380968);
const VOID_RIFT_PAGE = wiki("https://oldschool.runescape.wiki/w/Void_Rift", 15380527);
const NO_WIKI_TICKS = noWiki("the wiki's phase 4 steps give the order of events but no tick counts (Strategies rev 15381030)");
const NO_WIKI_P4 = noWiki("the wiki's phase 4 steps do not state it (Strategies rev 15381030)");
const NO_WIKI_ARENA = noWiki("the wiki has no tile layout of the phase 4 platform (Strategies rev 15381030, Ocellus rev 15380968)");
export const NO_WIKI_PRESENTATION = noWiki("presentation from the cache or footage, not a game rule");
export const NO_WIKI_PRACTICE = noWiki("a trainer option, not game data");
export const pose = (id: number, name: string, basis: Basis, note: string): Selected<number> =>
  selected(id, basis, "unscaled", note, NO_WIKI_PRESENTATION, cache(`seq ${id} ${name}`));
const DEFLECT_MELEE_SEEN = [vod("V1", "G53, G55 to G57, G109, G115 to G117, G153, G154, G175 to G177"), vod("V2", "k48, k60, k70 to k72, k131, k132, k168, k170, k250 to k252")] as const;
const DEFLECT_RANGE_SEEN = [vod("V1", "G64 to G85 but G74, G124 to G145 but G133, G184 to G186, G189 to G193"), vod("V2", "k79 to k93, k143 to k153, k199, k200, k214 to k217, k259 to k273 but k266")] as const;
const SOUL_SPLIT_SEEN = [vod("V1", "G58 to G62, G86 to G91, G118 to G122, G146 to G151, G178 to G182"), vod("V2", "k73 to k77, k133 to k136, k161 to k166, k253 to k257")] as const;
const STRATEGIES = wiki("https://oldschool.runescape.wiki/w/The_Fractured_Archive/Strategies", 15378365);
const BOSS_PAGE = wiki("https://oldschool.runescape.wiki/w/Ocellus", 15379038);
const ORB_OFF_HOLES = owner("healing orbs never spawn on a floor hole; community feedback", "2026-10-23");
const STRATEGIES_RIFTS = wiki("https://oldschool.runescape.wiki/w/The_Fractured_Archive/Strategies", 15379263);
const STRATEGIES_VOID_POOLS = wiki("https://oldschool.runescape.wiki/w/The_Fractured_Archive/Strategies", 15380016);
const DEFLECT_MELEE_PAGE = wiki("https://oldschool.runescape.wiki/w/Deflect_Melee", 15124245);
export const DEFENCE_REDUCTION_TABLE = wiki("https://oldschool.runescape.wiki/w/The_Fractured_Archive/Strategies", 15379033);
export const HOTFIX_NEWS = news("https://secure.runescape.com/m=news/the-fractured-archive---out-today?oldschool=1");
const SOLO_SCALE = news("https://secure.runescape.com/m=news/the-fractured-archive---everything-you-need-to-know?oldschool=1");

export type AmmunitionClass = "light" | "standard" | "heavy";
type Footprint = "blocks-movement" | "walkable";

type BossRecipe = Readonly<{
  npcId: Selected<number>;
  size: Selected<number>;
  combatLevel: Selected<number>;
  demonbaneMultiplier: Selected<number>;
  stats: Selected<Readonly<{ attack: number; strength: number; defence: number; range: number; magic: number }>>;
  defenceBonuses: Selected<Readonly<{ stab: number; slash: number; crush: number; magic: number }>>;
  rangedDefence: Selected<Readonly<Record<AmmunitionClass, number>>>;
  lowestDefencePercent: Selected<number>;
  footprint: Selected<Readonly<Record<Stage, Footprint>>>;
}>;

type LeadInRecipe = Readonly<{
  hiddenFor: Selected<TickSpan>;
  presentFor: Selected<TickSpan>;
  presentBoss: Selected<"present-damageable">;
  shout: Selected<Readonly<{ text: string; at: TickSpan; lasts: TickSpan }>>;
}>;

export type DamageRange = Readonly<{ min: number; max: number }>;

export type VoidRecipe<K extends VoidKind> = Readonly<{
  kind: K;
  duration: Selected<TickSpan>;
  orbMaturesAfterHit: Selected<TickSpan>;
  orbLingersAfterClear: Selected<TickSpan>;
}>;

export type TransitionRecipe<K extends TransitionKind> = Readonly<{
  kind: K;
  duration: Selected<TickSpan>;
  tellAfterStart: Selected<TickSpan>;
  hitAfterStart: Selected<TickSpan>;
  soulSplitAfterTell: Selected<TickSpan>;
}>;

type CycleRecipe = readonly [
  VoidRecipe<"inner-void">,
  TransitionRecipe<"after-inner">,
  VoidRecipe<"outer-void">,
  TransitionRecipe<"after-outer">,
];

type OverheadRecipe = Readonly<{
  "inner-void": Selected<"deflect-melee">;
  "outer-void": Selected<"deflect-range">;
  transition: Selected<"soul-split">;
  offBeforeVoid: Selected<TickSpan>;
}>;

type LifeforceRecipe = Readonly<{ tellAfterOnset: Selected<TickSpan>; hitAfterOnset: Selected<TickSpan>; tellChat: Selected<string> }>;
type ExplosionRecipe = Readonly<{
  firstMarkAfterHit: TickSpan;
  count: number;
  period: TickSpan;
  impactAfterMark: TickSpan;
  damage: DamageRange;
}>;

export type SpecialSelection =
  | Readonly<{ kind: "random-uniform" }>
  | Readonly<{ kind: "rotation"; order: readonly [Special, ...Special[]] }>
  | Readonly<{ kind: "replay"; order: readonly [Special, ...Special[]] }>;

export type UnclaimedOrbRule = Readonly<{ kind: "heals-boss"; afterHit: TickSpan }> | Readonly<{ kind: "off" }>;
type SpecialRecipe = Readonly<{
  styles: Readonly<{ "black-disk": Selected<"melee">; "spike-disk": Selected<"ranged">; vortex: Selected<"magic"> }>;
  protectedDamage: Selected<DamageRange>;
  unprotectedDamage: Selected<DamageRange>;
  cues: Readonly<Record<Style, readonly Selected<TransitionCue>[]>>;
}>;
export type SpecialStyle<V extends Special> = SpecialRecipe["styles"][V]["value"];
type BossHealRecipe = Readonly<{ soulSplitAfterHit: Selected<TickSpan> }>;
type RiftPose = "idle" | "spawn" | "despawn" | "detonate";
type RiftRecipe = Readonly<{
  firstCycle: Selected<Cycle>;
  spawnBeforeOnset: Selected<TickSpan>;
  chargeAfterSpawn: Selected<TickSpan>;
  timerBar: Selected<Readonly<{ background: string; fill: string }>>;
  npcId: Selected<number>;
  name: Selected<string>;
  combatLevel: Selected<number>;
  size: Selected<number>;
  stats: Selected<Readonly<{ attack: number; strength: number; defence: number; range: number; magic: number; hitpoint: number }>>;
  defenceBonuses: Selected<Readonly<{ stab: number; slash: number; crush: number; magic: number; range: number }>>;
  countFromFirstCycle: Selected<readonly [number, ...number[]]>;
  distanceFromBoss: Selected<Readonly<{ min: number; max: number }>>;
  burstDamage: Selected<DamageRange>;
  standardRangedAndMeleeRoll: Selected<Readonly<{ guaranteedHit: boolean; maxDamage: boolean }>>;
  killChat: Selected<string>;
  killEmpowers: Selected<"resets-attack-delay">;
  poses: Readonly<Record<RiftPose, Selected<number>>>;
  burstFlare: Selected<number>;
}>;

type WalkwayLook = Readonly<{ height: number; top: string; face: string; shade: string }>;
type BrazierRecipe = Readonly<{ loc: number; model: number; burning: number }>;

type GeometryRecipe = Readonly<{
  platform: Selected<readonly string[]>;
  bossAnchor: Selected<Tile>;
  playerSpawn: Selected<Tile>;
  walkway: Selected<WalkwayLook>;
  brazier: Selected<BrazierRecipe>;
}>;


type BossPose =
  | "idle"
  | "walk"
  | "deflectIn"
  | "deflectLoop"
  | "deflectOut"
  | "silentDeflectIn"
  | "silentDeflectLoop"
  | "silentDeflectOut"
  | "soulFragmentStart"
  | "soulFragmentEnd"
  | "prayerIn"
  | "prayerLoop"
  | "prayerOut"
  | "meleeHybrid"
  | "meleePrayer"
  | "unleashIn"
  | "unleashLoop"
  | "unleashOut"
  | "death";

export type TransitionSound = "meleeTell" | "meleeHit" | "rangedBeforeHit" | "rangedHit" | "magicWindUp";
export type TransitionCue = Readonly<{ sound: TransitionSound; afterTell: TickSpan; delayMs: number }>;
type CueSound = "endShout" | "flood" | "explosionSeriesStart" | "explosionMark" | "orbReturn" | TransitionSound;
type SoundPlayback = Readonly<{ volume: number; range: number; retain: number }>;

export type SpriteFrame = Readonly<{ archive: number; frame: number }>;

type DeathEffect = "burst" | "skirt" | "crack";

type PresentationRecipe = Readonly<{
  bossPoses: Readonly<Record<BossPose, Selected<number>>>;
  deathEffects: Readonly<Record<DeathEffect, Selected<number>>>;
  deathLasts: Selected<TickSpan>;
  levitation: Selected<Readonly<{ spotAnim: number; during: VoidKind }>>;
  deflectWind: Selected<number>;
  sounds: Readonly<Record<CueSound, Selected<SoundId>>>;
  soundPlayback: Selected<SoundPlayback>;
  landingBeforeInnerClears: Selected<TickSpan>;
  transitionTells: Readonly<Record<Special, Selected<number>>>;
  tellCentre: Selected<Readonly<{ faceColour: number; rgb: number }>>;
  overheadIcons: Readonly<Record<BossOverhead, Selected<SpriteFrame>>>;
  overheadIconBelowHpBar: Selected<number>;
}>;

const headIcon = (frame: number, note: string, seen: readonly Source[]): Selected<SpriteFrame> =>
  selected({ archive: 440, frame }, "footage-repeated", "unscaled", note, NO_WIKI_PRESENTATION, cache(`sprite 440 headicons_prayer frame ${frame}`), ...seen);

type StyleBonuses = Readonly<{ stab: number; slash: number; crush: number; magic: number; range: number }>;
export type ItemStats = Readonly<{
  attack: StyleBonuses;
  defence: StyleBonuses;
  other: Readonly<{ meleeStrength: number; rangedStrength: number; magicDamage: number; prayer: number }>;
}>;
type TrainerItem = Readonly<{ itemId: Selected<number>; stats: Selected<ItemStats> }>;

export const TIERS = ["raid", "max", "high", "mid", "low", "poor"] as const;
export type Tier = (typeof TIERS)[number];
export const START_WEAPONS = ["twistedBow", "blowpipe", "melee", "ralos"] as const;
export type StartWeapon = (typeof START_WEAPONS)[number];
export type TierStart = Readonly<{ weapon: StartWeapon; label: string; wear: readonly number[] }>;
export type TierStarts = readonly [TierStart, ...TierStart[]];
export type TierItem = Readonly<{ id: number; name: string; simulation: "simulated" | "no-item-class" | "stats-differ" }>;
export type TierSlot = Selected<TierItem> | null;
export type TierRecipe = Readonly<{
  label: string;
  equipment: Readonly<Record<EquipmentSlot, TierSlot>>;
  inventory: readonly TierSlot[];
  starts: TierStarts;
}>;
export type SupplyStockRecipe = readonly Readonly<{ item: Selected<TierItem>; quantity: number }>[];
type WornSet = Readonly<Record<Exclude<EquipmentSlot, "offhand">, string>>;
type BlowpipeRecipe = Readonly<{
  itemId: number;
  rapidSpeed: 2;
  otherSpeed: 3;
  range: 5;
  longrangeRange: 7;
  rangedAttack: number;
  rangedStrength: number;
  ammunition: AmmunitionClass;
}>;
export type TrainerItemKey = "inquisitorsGreatHelm" | "inquisitorsHauberk" | "inquisitorsPlateskirt" | "tonalzticsOfRalos";
type SdkIconKey = "masoriMaskF" | "masoriBodyF" | "masoriChapsF" | "zaryteVambraces";
type InquisitorPiece = "inquisitorsGreatHelm" | "inquisitorsHauberk" | "inquisitorsPlateskirt";
export type StanceSpeeds<T extends number = TickSpan> = Readonly<{ rapidSpeed: T; otherSpeed: T }>;

type RalosGraphics = Readonly<{
  animation: number;
  cast: number;
  glaives: readonly [Readonly<{ projectile: number; impact: number }>, Readonly<{ projectile: number; impact: number }>];
}>;

type GearRecipe = Readonly<{
  items: Readonly<Record<TrainerItemKey, TrainerItem>>;
  sdkCacheIds: Readonly<{ necklaceOfRupture: Selected<number> }>;
  sdkIcons: Readonly<Record<SdkIconKey, Selected<number>>>;
  blowpipe: Selected<BlowpipeRecipe>;
  loadout: Selected<LoadoutIds>;
  starts: Selected<TierStarts>;
  tiers: Readonly<Record<Exclude<Tier, "raid">, Selected<TierRecipe>>>;
  allianceSupplies: Selected<SupplyStockRecipe>;
  twistedBow: Selected<StanceSpeeds<TwistedBow["attackSpeed"]>>;
  ralos: Selected<StanceSpeeds & Readonly<{ range: number; longrangeRange: number; hits: number; hitMaxFraction: number }>>;
  division: Selected<Readonly<{ energy: number; accuracyFactor: number; defenceDrainOfMagic: number }>>;
  ralosGraphics: Selected<Readonly<Record<"throw" | "division", RalosGraphics>>>;
  quiverAmmo: Selected<Readonly<{ dragonCrossbow: number; zaryteCrossbow: number }>>;
  ammunition: Selected<Readonly<{ twistedBow: AmmunitionClass; tonalzticsOfRalos: AmmunitionClass; dragonCrossbow: AmmunitionClass; zaryteCrossbow: AmmunitionClass; ascensionCrossbows: AmmunitionClass }>>;
  inquisitorCrushPerMille: Selected<Readonly<Record<InquisitorPiece, number>>>;
  scytheStance: Selected<"jab">;
  scytheMaxHitsOnOneTarget: Selected<number>;
}>;

const BOSS: BossRecipe = {
  npcId: selected(16677, "inferred", "unscaled", "tfa_ocellus_p3, the only combat form after phase 2; live level 1601 differs from cache 1197 (C7)", BOSS_PAGE, cache("npc 16677")),
  size: selected(3, "spec-confirmed", "unscaled", "3x3 marker in both clips", BOSS_INFOBOX, cache("npc 16677 size"), vod("V1", "G29"), vod("V2", "k44")),
  combatLevel: selected(1601, "footage-repeated", "unscaled", "hover text Attack Ocellus (level-1601)", BOSS_INFOBOX, vod("V1", "frame 3317"), vod("V2", "k44")),
  demonbaneMultiplier: selected(1, "spec-single", "unscaled", "the wiki marks phases 1 and 3 as Demon; no reduced demonbane effectiveness is listed, so full effectiveness is inferred; phase 2 and the adds have no demon attribute listed", BOSS_PAGE, VOID_RIFT_PAGE),
  stats: selected({ attack: 325, strength: 250, defence: 250, range: 300, magic: 300 }, "spec-confirmed", "unscaled", "the wiki's phase 3 infobox, edited after the 21 October hotfix, lists the cache's levels", BOSS_PAGE, cache("npc 16677 stats [325, 250, 250, 5250, 300, 300]")),
  defenceBonuses: selected({ stab: 150, slash: 100, crush: 30, magic: 200 }, "spec-confirmed", "unscaled", "cache params 5 to 8 match the wiki's phase 3 infobox", BOSS_PAGE, cache("npc 16677 params 5, 6, 7, 8")),
  rangedDefence: selected({ light: 250, standard: 250, heavy: 250 }, "spec-single", "unscaled", "the wiki's phase 3 infobox; the cache decode has no ranged defence param", BOSS_PAGE),
  lowestDefencePercent: selected(60, "spec-single", "unscaled", "the 21 October hotfix caps Defence reduction at 60% of the level: phase 3 Defence stops at 150 of 250; how a fractional floor rounds is not stated, rounded up (inferred)", BOSS_PAGE, DEFENCE_REDUCTION_TABLE, HOTFIX_NEWS),
  footprint: selected(
    { "lead-in": "walkable", "inner-void": "walkable", "after-inner": "walkable", "outer-void": "blocks-movement", "after-outer": "walkable" },
    "community-tested",
    "unscaled",
    "community feedback 2026-10-23, unconfirmed: in the outer void, the melee phase, the boss's 3x3 blocks the player, who paths around his edge instead of under him; no report covers the other stages, so they keep the trainer's walkable footprint",
    NO_WIKI_P4, owner("a redditor's comment relayed by the owner: you can run under the boss during the melee phase whereas in game it will path you around the edge of the boss", "2026-10-23"),
  ),
};

const LEAD_IN: LeadInRecipe = {
  hiddenFor: selected(span(4), "footage-repeated", "team-4-and-5", "boss model gone from t = 0, back on the main platform at t = 4", NO_WIKI_TICKS, vod("V1", "G25 to G29"), vod("V2", "k40 to k44")),
  presentFor: selected(span(4), "footage-repeated", "team-4-and-5", "present from t = 4, the first inner void at t = 8", NO_WIKI_TICKS, vod("V1", "G29 to G33, first hit G35"), vod("V2", "k44 to k48, first splats k48")),
  presentBoss: selected(
    "present-damageable",
    "log-repeated",
    "unscaled",
    "players' hits land on him once he is back, before his first Deflect: at S-1 (t = 7) in one kill and at S-3 and S-1 (t = 5 and 7) in the other; both clips show no splat before t = 8, but a logged hitsplat is direct evidence where a clip only shows that nobody hit him, so he takes damage from t = 4",
    NO_WIKI_TICKS, fightLog("L1", "4 hits on him at S-1"),
    fightLog("L2", "a hit on him at S-3 and 3 at S-1"),
    vod("V1", "G29 to G33, first hit G35"),
    vod("V2", "k44 to k48, first splats k48"),
  ),
  shout: selected(
    { text: "End...", at: span(5), lasts: span(3) },
    "footage-repeated",
    "team-4-and-5",
    "overhead text from t = 5 for 3 ticks; the fight logs have it 3 ticks before his first Deflect in all four logged fights that reached phase 4, as here",
    STRATEGIES_P4, vod("V1", "G30 to G32"), vod("V2", "k45 to k47"),
    fightLog("L1", "S-3"), fightLog("L2", "S-3"), fightLog("L5", "S-3"), fightLog("L6", "S-3"),
  ),
};

const INNER_VOID: VoidRecipe<"inner-void"> = {
  kind: "inner-void",
  duration: selected(span(22), "footage-repeated", "team-4-and-5", "inner void visible 22 ticks", NO_WIKI_TICKS, vod("V1", "G33-G54, G93-G114, G153-G174"), vod("V2", "k48-k69, k108-k129, k168-k189, k228-k249")),
  orbMaturesAfterHit: selected(
    span(12),
    "footage-repeated",
    "team-4-and-5",
    "orb glows teal 12 ticks after the hit; the fight log has the game send the glowing orb, spotanim 4310, from S+16 in all three cycles it recorded",
    NO_WIKI_TICKS, vod("V1", "G49"), vod("V2", "k64"), cache("spotanim 4311 soul_fragment_spawn_12_ticks"),
    fightLog("L6", "4310 sent on the orb from S+16 to S+27, 4312 at S+28, cycles 1 to 3"),
  ),
  orbLingersAfterClear: selected(
    span(6),
    "log-repeated",
    "unscaled",
    "the game sends the glowing inner orb, spotanim 4310, through S+27 and its despawn, 4312, at S+28 in all three cycles one fight log recorded, so it stays pickable through S+27, past the tell at S+24 and before the hit at S+29; this replaces an estimate of 5 ticks from community feedback that an orb stays a few seconds into the attack you pray against",
    NO_WIKI_TICKS, fightLog("L6", "4310 sent on the inner orb from S+16 to S+27 and 4312 at S+28, cycles 1 to 3"),
    owner("healing orbs despawn almost instantly after a phase ends when usually you can grab it for a few seconds during the attack you need to pray against", "2026-10-23"),
    vod("V1", "G175"),
  ),
};

const AFTER_INNER: TransitionRecipe<"after-inner"> = {
  kind: "after-inner",
  duration: selected(span(9), "footage-repeated", "team-4-and-5", "inner void clears at S+22, outer forms at S+31", NO_WIKI_TICKS, vod("V1", "G55-G63"), vod("V2", "k70-k78")),
  tellAfterStart: selected(span(2), "footage-repeated", "team-4-and-5", "transition attack 1 starts at S+24", NO_WIKI_TICKS, vod("V1", "G57, G117, G177"), vod("V2", "k72, k132, k192, k252")),
  hitAfterStart: selected(span(7), "footage-repeated", "team-4-and-5", "transition attack 1 damage at S+29", NO_WIKI_TICKS, vod("V1", "G62, G122, G182"), vod("V2", "k77, k137, k197, k257")),
  soulSplitAfterTell: selected(span(1), "footage-repeated", "team-4-and-5", "Soul Split at S+25; Deflect Melee still up at S+24", NO_WIKI_TICKS, vod("V1", "frames 2741-2777, 4901-4937"), vod("V2", "k73")),
};

const OUTER_VOID: VoidRecipe<"outer-void"> = {
  kind: "outer-void",
  duration: selected(span(20), "footage-repeated", "team-4-and-5", "outer void visible 20 ticks", NO_WIKI_TICKS, vod("V1", "G64-G83, G124-G143"), vod("V2", "k79-k98, k139-k158, k199-k218")),
  orbMaturesAfterHit: selected(
    span(6),
    "footage-repeated",
    "team-4-and-5",
    "outer orb first glows 5 to 6 ticks after the hit; the fight log has the game send the glowing orb, spotanim 4310, from S+41, 6 ticks after the hit, in both cycles it recorded",
    NO_WIKI_TICKS, vod("V1", "G74"), vod("V2", "k88, k149"), cache("spotanim 4309 soul_fragment_spawn_6_ticks"),
    fightLog("L6", "4310 sent on the orb from S+41 to S+52, 4312 at S+53, cycles 1 and 2"),
  ),
  orbLingersAfterClear: selected(
    span(2),
    "log-repeated",
    "unscaled",
    "the flood clears at S+51 and the game sends the glowing outer orb, spotanim 4310, through S+52 and its despawn, 4312, at S+53 in both cycles one fight log recorded, so the last pickup is S+52, a tick into the tell; an unclaimed outer orb heals the boss at hit + 19, S+54 (C17)",
    NO_WIKI_TICKS, fightLog("L6", "4310 sent on the outer orb from S+41 to S+52 and 4312 at S+53, cycles 1 and 2"),
    vod("V1", "G147"),
    vod("V2", "k102, k222"),
    owner("healing orbs despawn almost instantly after a phase ends when usually you can grab it for a few seconds during the attack you need to pray against", "2026-10-23"),
  ),
};

const AFTER_OUTER: TransitionRecipe<"after-outer"> = {
  kind: "after-outer",
  duration: selected(span(9), "footage-repeated", "team-4-and-5", "outer void clears at S+51, next inner at S+60", NO_WIKI_TICKS, vod("V1", "G84-G92"), vod("V2", "k99-k107")),
  tellAfterStart: selected(span(1), "footage-repeated", "team-4-and-5", "transition attack 2 starts at S+52; one of five onsets came a tick late (k161), damage tick unchanged", NO_WIKI_TICKS, vod("V1", "G85, G145"), vod("V2", "k100, k220")),
  hitAfterStart: selected(span(6), "footage-repeated", "team-4-and-5", "transition attack 2 damage at S+57", NO_WIKI_TICKS, vod("V1", "G90, G150"), vod("V2", "k105, k165, k225")),
  soulSplitAfterTell: selected(span(1), "footage-once", "team-4", "Soul Split at S+53", NO_WIKI_TICKS, vod("V1", "frames 3749-3785")),
};

const CYCLE: CycleRecipe = [INNER_VOID, AFTER_INNER, OUTER_VOID, AFTER_OUTER];

const OVERHEADS: OverheadRecipe = {
  "inner-void": selected("deflect-melee", "footage-repeated", "team-4-and-5", "up from the rise at S+0 to S+24 in all 7 cycles filmed, and absent the tick before the rise; the hovering boss's icon is mostly above the frame, and S+21 is never in it", STRATEGIES, ...DEFLECT_MELEE_SEEN),
  "outer-void": selected("deflect-range", "footage-repeated", "team-4-and-5", "up with the flood from S+31 and through S+52, two ticks after it clears, in all 7 floods filmed", STRATEGIES, ...DEFLECT_RANGE_SEEN),
  transition: selected("soul-split", "footage-repeated", "team-4-and-5", "white star after each transition tell", STRATEGIES_P4, vod("V1", "frames 2777, 3785, 4937"), vod("V2", "k73")),
  offBeforeVoid: selected(span(1), "footage-repeated", "team-4-and-5", "no icon at S+30 in 5 cycles and at S+59 in 3, with the boss and his HP bar in frame and the icon up on the ticks either side", NO_WIKI_TICKS, vod("V1", "G63, G123, G183, G92, G152"), vod("V2", "k78, k258, k167")),
};

export type DeflectRule = Readonly<{ kind: "block"; reflectPercent: number }> | Readonly<{ kind: "none" }>;

const DEFLECTS: Readonly<Record<BossOverhead, Selected<Style | null>>> = {
  "deflect-melee": selected("melee", "inferred", "unscaled", "named for the style it turns away; no capture shows a melee hit landing during it (Q8)", STRATEGIES, vod("V2", "k60, k71")),
  "deflect-range": selected("ranged", "inferred", "unscaled", "named for the style it turns away; no capture shows a ranged hit landing during it (Q8)", STRATEGIES, vod("V2", "k80, k90")),
  "soul-split": selected(null, "inferred", "unscaled", "a healing prayer that turns no style away", STRATEGIES, vod("V2", "k73")),
};

const LIFEFORCE: LifeforceRecipe = {
  tellAfterOnset: selected(span(3), "footage-repeated", "team-4-and-5", "teal swirl and chat line", NO_WIKI_TICKS, vod("V1", "G36, G127"), vod("V2", "k51")),
  hitAfterOnset: selected(span(4), "footage-repeated", "team-4-and-5", "hit 4 ticks after each void forms", NO_WIKI_TICKS, vod("V1", "G37, G68, G97, G128, G157, G188"), vod("V2", "k52, k83, k112, k143, k172, k203")),
  tellChat: selected("Ocellus manipulates your lifeforce!", "footage-repeated", "team-4-and-5", "game chat line on the tell tick, first in the frame that shows the teal swirl", NO_WIKI_P4, vod("V1", "3:54:02.78, G36"), vod("V2", "5:20:25.87, k51")),
};

const cue = (sound: TransitionSound, afterTell: number, delayMs: number, note: string, first: Source, ...rest: Source[]): Selected<TransitionCue> =>
  selected({ sound, afterTell: span(afterTell), delayMs }, "footage-repeated", "team-4-and-5", note, NO_WIKI_PRESENTATION, first, ...rest);

const SPECIAL: SpecialRecipe = {
  styles: {
    "black-disk": selected("melee", "footage-repeated", "team-4-and-5", "Kirby on Protect from Melee takes 7 and a teammate 50; the streamer on Magic takes 43 while four others take 6", STRATEGIES_P4, vod("V1", "G62, G90"), vod("V2", "k137")),
    "spike-disk": selected("ranged", "footage-repeated", "team-4-and-5", "players on Protect from Missiles take 7, 5 and 9", STRATEGIES_P4, vod("V1", "G122"), vod("V2", "k105, k197")),
    vortex: selected("magic", "footage-repeated", "team-5", "players on Protect from Magic take 7 twice", STRATEGIES_P4, vod("V2", "k77, k165")),
  },
  protectedDamage: selected(
    { min: 5, max: 12 },
    "log-repeated",
    "team-4-and-5",
    "5 to 12 in 150 hits under the matching prayer in six raid logs (12 twice, 11 six times); 7, 6, 7, 6, 9 on Kirby and 7, 5, 7, 9 on the streamer under the matching prayer, and a 10 in a fight log, on a player whose hitsplat shows Protect from Magic at S+57 of cycle 4; that log's own line for the hit says no prayer, but 10 is far below the 43 to 50 an unprotected player takes, so the hitsplat's prayer is taken (inferred); the solo carry-over is inferred",
    STRATEGIES_P4, vod("V1", "G62, G90, G122, G150, G182"), vod("V2", "k77, k105, k165, k197"),
    fightLog("L6", "Player 12 takes 10 (overhead MAGIC) at P4 +241, S+57 of cycle 4"),
  ),
  unprotectedDamage: selected({ min: 43, max: 50 }, "footage-repeated", "team-4-and-5", "50 on a teammate whose prayer is not seen, 43 on the streamer under the wrong prayer; the solo carry-over is inferred", STRATEGIES_P4, vod("V1", "G62"), vod("V2", "k137")),
  cues: {
    melee: [
      cue("meleeTell", 0, 60, "tell + 0.1 in all 5 melee attacks; 0.1 tick is 60 ms", vod("V1", "3:54:32.45, t60.1")),
      cue("meleeHit", 5, 60, "tell + 5.1, on the hit tick, in all 5 melee attacks", vod("V1", "3:54:18.66, t37.1")),
    ],
    ranged: [
      cue("rangedBeforeHit", 4, 240, "tell + 4.4, the median of 4.4, 4.4 and 4.6 in 3 of 4 ranged attacks, about 0.6 tick before the hit; the fourth was at tell + 0.9; 0.4 tick is 240 ms", vod("V1", "3:54:54.23, t96.4"), vod("V2", "5:20:58.27, t64.6")),
      cue("rangedHit", 5, 60, "tell + 5.1, on the hit tick, in 3 of 4 ranged attacks", vod("V1", "t97.1, t157.1"), vod("V2", "t65.3")),
    ],
    magic: [
      cue("magicWindUp", 2, 120, "tell + 2.2, the median of 0.7, 2.2 and 2.3 in 3 of 3 magic attacks; 0.2 tick is 120 ms. The magic hit's 12553 is spotanim 4329's own frame sound", vod("V2", "5:20:39.13, t32.7"), vod("V2", "t122.3, t214.2")),
    ],
  },
};

const BOSS_HEALS: BossHealRecipe = {
  soulSplitAfterHit: selected(span(2), "footage-repeated", "team-4-and-5", "boss heals by wrong-prayer damage only: +50 and +43 while protected players took 7 and 6", NO_WIKI_TICKS, vod("V1", "G62 then G64"), vod("V2", "k137 then k139")),
};

const RIFTS: RiftRecipe = {
  firstCycle: selected(cycle(2), "footage-repeated", "team-5", "rifts before every inner void after the first (C5)", STRATEGIES, vod("V2", "k107, k167, k227")),
  spawnBeforeOnset: selected(
    span(1),
    "footage-repeated",
    "team-4-and-5",
    "rifts one tick before the next inner void, as in every cycle of the fight logs",
    NO_WIKI_TICKS, vod("V1", "G152"), vod("V2", "k107, k167, k227"),
    fightLog("L2", "S-1 of cycle 2"), fightLog("L5", "S-1 of cycles 2 and 3"), fightLog("L6", "S-1 of cycles 2 to 5"),
  ),
  chargeAfterSpawn: selected(
    span(30),
    "log-repeated",
    "unscaled",
    "every rift left alive in the fight logs burst 30 ticks after it appeared, at S+29: it played its detonate sequence, the void flare (spotanim 4306) showed on every player and each took the hit on that tick, and the rift was gone 2 ticks later; one rift in one raid and three over two cycles of the other. This replaces the owner's estimate of about 14 s, 23 ticks, from a timer watched in game; both clips show a rift standing after spawn + 11, V1 at G164 and V2 from k177 to k196, as 30 allows",
    NO_WIKI_TICKS, fightLog("L5", "a rift from S-1 of cycle 3 bursts at S+29"),
    fightLog("L6", "a rift from S-1 of cycle 2 and two from S-1 of cycle 3 burst at S+29"),
    vod("V1", "G152 to G168"),
    vod("V2", "k167 to k196"),
  ),
  timerBar: selected(
    { background: "#1e1e0c", fill: "#e0c020" },
    "footage-once",
    "unscaled",
    "the owner's in-game picture, read by the lead: under each rift's green HP bar and touching it, a bar of the same width and height, dark olive background, yellow fill from the left, about a tenth full on both rifts; that the fill tracks the charge and is full on the burst tick is inferred from that one frame",
    NO_WIKI_PRESENTATION, owner("rift timer bar picture", "2026-10-22"),
  ),
  npcId: selected(16678, "spec-confirmed", "unscaled", "tfa_ocellus_p3_bombportal_basic, Void Rift", VOID_RIFT_PAGE, cache("npc 16678"), vod("V2", "k193")),
  name: selected("Void Rift", "spec-confirmed", "unscaled", "hover text Attack Void Rift (level-138)", VOID_RIFT_PAGE, cache("npc 16678 name"), vod("V2", "k193")),
  combatLevel: selected(138, "spec-confirmed", "unscaled", "cache level matches the hover text", VOID_RIFT_PAGE, cache("npc 16678 combat level"), vod("V2", "k193")),
  size: selected(1, "spec-confirmed", "unscaled", "one-tile shard", noWiki("the Void Rift infobox leaves size empty (rev 15380527)"), cache("npc 16678 size")),
  stats: selected({ attack: 1, strength: 1, defence: 175, range: 1, magic: 300, hitpoint: 44 }, "spec-confirmed", "unscaled", "the rift never attacks", VOID_RIFT_PAGE, cache("npc 16678 stats [1, 175, 1, 44, 1, 300]")),
  defenceBonuses: selected({ stab: 0, slash: 0, crush: 0, magic: 0, range: 0 }, "spec-confirmed", "unscaled", "params 5 to 8 are 0; the decode has no ranged defence param, taken as 0 (inferred)", VOID_RIFT_PAGE, cache("npc 16678 params 5, 6, 7, 8")),
  countFromFirstCycle: selected<readonly [number, ...number[]]>(
    [2, 3, 4, 5],
    "log-repeated",
    "team-7",
    "the rifts for each cycle from the first rift cycle on, one tick before its inner void: one fight log has 2, 3, 4 and 5 for cycles 2 to 5, and the other that reached a rift cycle has 2 for cycle 2; the last count repeats, so a cycle after the fifth also gets 5 (inferred, no log reached a sixth cycle)",
    noWiki("the wiki says rifts spawn but gives no count (Strategies rev 15381030)"),
    fightLog("L6", "Void Rift appears 2, 3, 4 and 5 times at P4 +63, +123, +183 and +243, S-1 of cycles 2 to 5"),
    fightLog("L2", "2 at P4 +63, S-1 of cycle 2"),
  ),
  distanceFromBoss: selected(
    { min: 2, max: 5 },
    "log-repeated",
    "team-7",
    "each rift on its own floor tile 2 to 5 tiles from the boss's 3x3, new tiles each cycle: the 16 rifts two fight logs record on this platform all stand on its floor, 2 to 5 from him; which tiles is taken as a seeded random pick, and that rifts avoid floor holes, as healing orbs do, is inferred",
    NO_WIKI_ARENA,
    fightLog("L6", "14 rifts in cycles 2 to 5, at 5 and 4; 4, 4 and 4; 4, 5, 2 and 3; 4, 4, 4, 2 and 3 tiles from his 3x3"),
    fightLog("L2", "2 rifts in cycle 2, at 5 and 3 tiles from his 3x3"),
  ),
  burstDamage: selected(
    { min: 28, max: 41 },
    "log-repeated",
    "team-7",
    "one typeless hit on each player per burst, however many rifts burst: 41 and 40 on the two players left when one rift burst, both under Protect from Magic, and 30 and 28 when two burst together, one under Protect from Missiles, in the same raid; the other raid's one burst hit its last player for 3 on the tick the transition attack also hit him for 3, and he died, so both hits were cut to his last HP and give no amount (inferred). The 14 the streamer took 11 ticks after the rifts appeared is the next cycle's first explosion, at S+10, which hit 14 to 16 in the logs",
    noWiki("the wiki says an unkilled rift damages all players but gives no amount (Strategies rev 15381030)"),
    fightLog("L6", "41 and 40 at S+29 of cycle 2, one rift; 30 and 28 at S+29 of cycle 3, two rifts"),
    fightLog("L5", "3 and 3 at S+29 of cycle 3 on a player who then died"),
    vod("V2", "k118, k178"),
  ),
  standardRangedAndMeleeRoll: selected(
    { guaranteedHit: true, maxDamage: true },
    "community-tested",
    "unscaled",
    "the wiki: \"Ocellus will spawn void crystals that the player will always max hit with standard range attacks\"; the owner saw them almost always one-shot; a player who played the trainer on stream said melee attacks also always max-hit them in game; standard read as every ranged or melee attack but a special attack, and magic and special attacks roll as on any target (inferred)",
    BOSS_PAGE,
    owner("rifts almost always one-shot", "2026-10-22"),
    owner("Gnomonkey, playing the trainer on stream: melee attacks also always max-hit void rifts", "2026-10-24"),
  ),
  killChat: selected("Destroying the void rift empowers you!", "footage-repeated", "team-4-and-5", "game chat line when a rift dies; the wiki says what the empower does (killEmpowers)", NO_WIKI_P4, vod("V1", "3:55:21.98"), vod("V2", "k116")),
  killEmpowers: selected(
    "resets-attack-delay",
    "spec-single",
    "unscaled",
    "the wiki: \"It empowers you, resetting your tick cool down.\"; read as the player's attack delay set to 0, so the next attack can go at once; it applies on the tick the rift is destroyed, the tick the chat line shows, because the wiki gives no tick (inferred)",
    VOID_RIFT_PAGE,
  ),
  poses: {
    idle: pose(14895, "vfx_ocellus_voidflare_default_idle", "spec-confirmed", "rift stand and walk animation"),
    spawn: pose(14896, "vfx_ocellus_voidflare_default_spawn", "inferred", "rift appearing, 1 tick, frame sound 12643"),
    despawn: pose(14897, "vfx_ocellus_voidflare_default_despawn", "inferred", "rift dying, 1 tick, frame sound 12640"),
    detonate: pose(14898, "vfx_ocellus_voidflare_default_detonate", "inferred", "rift releasing its charge, 2 ticks, frame sounds 12641 and 12642"),
  },
  burstFlare: selected(
    4306,
    "log-repeated",
    "unscaled",
    "vfx_human_ocellus_voidflare_default shares the rift's model 62369; played on each player on the burst tick, with the hit, in every burst of the fight logs",
    NO_WIKI_PRESENTATION, cache("spotanim 4306 vfx_human_ocellus_voidflare_default"),
    fightLog("L5", "S+29 of cycle 3"),
    fightLog("L6", "S+29 of cycles 2 and 3"),
  ),
};

const FLOOD_FRAMES = vod("V2", "k86, k95, k142, k156, k205, k212, k262, k269");
const V1_FLOOD_FRAMES = vod("V1", "G66, G126, G130");

const GEOMETRY: GeometryRecipe = {
  platform: selected(
    [
      "...?........ww",
      ".?##########ww",
      ".###########ww",
      ".###########ww",
      ".##########/w.",
      ".#########/w..",
      ".########/w...",
      ".#######ww....",
      ".######wb.....",
      ".#####ww......",
      ".####ww.......",
      ".###ww........",
      "wwwww.........",
    ],
    "community-tested",
    "unscaled",
    "row y = 0 first, x = 0 leftmost; # is floor, . is not floor, ? is a tile the kills disagree on (±1 tile) and is left blocked, w is the raised brazier walkway, b its brazier and / a diagonal wall tile whose floor half is its north-west triangle, all drawn and never walkable; the walkway is the band 2 tiles past the floor's edge, ending where J1 ends it at y 12; cache 2746 stores map square 16472 unencrypted, and on its plane 1, at x = 32 + column and y = 40 - row, the blocked-floor flags give the east and diagonal edges: floor on x 11 for rows 1 to 3, where players stack the holes, then one tile in per row, x + y <= 14, from (10, 4) to (3, 11), which is J1's floor on (10, 4), (9, 5) and (8, 6) that V2's walkway base excluded; type 9 diagonal walls (loc 4451) stand on (11, 4), (10, 5) and (9, 6), so the wall runs straight from the end of the straight run to the jut, and the jut is loc 7261's L-shaped walls on (8, 7) and (7, 8) around the 5x5's corner beside the brazier on (8, 8), so no path runs behind the boss; a triangle with 2-tile bands north and west of the 5x5 and the brazier walkway on the diagonal; V2's drawn void and J1's rims agree on both legs, J1 adds the 6 floor tiles the boss hid south of the 5x5 in V2, and V2's north strip is left out because V1 and J1 drop away there; 84 floor tiles; seen with teams of 2 (J1), 4 (V1) and 5 (V2)",
    NO_WIKI_ARENA, owner("redditor: the tiles on the east side are 1 too close to the boss and need dragging out by 1", "2026-10-23"),
    owner("in-game picture: the wall runs straight 3 tiles in, then a smooth diagonal with 2 full tiles until the jut", "2026-10-23"),
    FLOOD_FRAMES,
    vod("V2", "k060 to k269, walkway base and strip rims, 18 frames"),
    vod("V2", "k080, bare floor south of the 5x5"),
    V1_FLOOD_FRAMES,
    owner("P4 platform screenshot: the triangle and the brazier walkway"),
    cache("map square 16472 plane 1: blocked-floor flags; locs 4451 (type 9) and 7261 (type 2)"),
  ),
  bossAnchor: selected(tile(4, 6), "footage-repeated", "team-4-and-5", "south-west tile of the boss's 3x3 at x 4-6, y 4-6, centred in the 5x5 at x 3-7, y 3-7; the cyan 3x3 marker sits inside the purple 5x5 rim in every fitted frame", NO_WIKI_ARENA, FLOOD_FRAMES, V1_FLOOD_FRAMES),
  playerSpawn: selected(tile(5, 1), "inferred", "team-4-and-5", "two tiles north of the 5x5, where players wait through the first inner void; no clip pins one tile", NO_WIKI_ARENA, vod("V2", "k49 to k52"), vod("V1", "G33")),
  walkway: selected(
    { height: 0.4, top: "#6b6c40", face: "#8e9a80", shade: "#3c4233" },
    "footage-once",
    "unscaled",
    "a raised curb about 0.4 tile high with an olive top and a light stone face toward the platform; colours are approximate medians of the curb in one frame; on a diagonal wall tile the curb fills the outer half and faces the floor along the diagonal, and the floor half is drawn as floor and floods with the floor beside it (inferred: the cache paints the whole tile with the band's overlay 656 and stands the raised wall on the diagonal, so the wall is the edge players see)",
    NO_WIKI_PRESENTATION, vod("V2", "k256, curb beside the 5x5"),
    owner("P4 platform screenshot: the triangle and the brazier walkway"),
    cache("map square 16472 plane 1: overlay 656 under locs 4451 (type 9)"),
  ),
  brazier: selected(
    { loc: 62697, model: 62440, burning: 14833 },
    "assumption",
    "unscaled",
    "a god censer hangs over the fire bowl in the curb's step; the purple one in V2 reads as the Zarosian Censer, one of the raid's four (62693 to 62700); P4 use of the censers is not seen, so it is scenery; the fire bowl and its stand are among the raid's unnamed locs and are not drawn",
    NO_WIKI_PRESENTATION, vod("V2", "k256, purple censer over the fire bowl on the curb"),
    vod("V1", "G146, fire bowl in the curb's step beside the 5x5"),
    cache("loc 62697 Zarosian Censer: model 62440, animation 14833"),
  ),
};

type FloorDamage = Readonly<{ kind: "damages"; afterOnset: TickSpan; perTick: DamageRange }>;
export type FloorRule = FloorDamage | Readonly<{ kind: "harmless" }>;
export type FloorShape = "near-square" | "platform-minus-near-square";

type FloorRecipe = Readonly<{
  squareSide: Selected<number>;
  shapes: Readonly<{ "inner-void": Selected<"near-square">; "outer-void": Selected<"platform-minus-near-square"> }>;
  outerDamage: Selected<FloorDamage>;
  look: Selected<Readonly<{ void: string; stars: string; rim: string }>>;
}>;

const FLOOD_PER_TICK: DamageRange = { min: 9, max: 11 };

const FLOOR: FloorRecipe = {
  squareSide: selected(5, "footage-repeated", "team-4-and-5", "the boss's 3x3 plus a 1-tile ring", STRATEGIES, vod("V1", "frame 4325"), vod("V2", "k86")),
  shapes: {
    "inner-void": selected("near-square", "footage-repeated", "team-4-and-5", "the 5x5 under and around the boss", STRATEGIES, vod("V1", "G33, G93, G153"), vod("V2", "k48, k108, k168, k228")),
    "outer-void": selected("platform-minus-near-square", "footage-repeated", "team-4-and-5", "all floor but the 5x5; floor the client leaves undrawn is not safe (C16), and the platform leaves out V2's undrawn strip north of it", STRATEGIES, vod("V1", "G64"), vod("V2", "k86, k93-k97")),
  },
  outerDamage: selected({ kind: "damages", afterOnset: span(5), perTick: FLOOD_PER_TICK }, "footage-once", "team-5", "standing on the flood from its onset, first damage at S+36; amounts 11, 9, 9, 9, 10, 11", NO_WIKI_P4, vod("V2", "k199 to k204"), vod("V2", "k92-k97")),
  look: selected({ void: "#1e2529", stars: "#babcc2", rim: "#9f48bd" }, "footage-repeated", "team-4", "starry near-black tiles inside a glowing purple rim; median colours of each in two frames", NO_WIKI_PRESENTATION, vod("V1", "G33, frame 1877"), vod("V1", "G64, frame 2993")),
};

const INNER_VOID_FLOOR = choice("one-tick-grace", {
  "one-tick-grace": selected<FloorRule>({ kind: "damages", afterOnset: span(2), perTick: FLOOD_PER_TICK }, "inferred", "team-5", "inside at S+0 and off by S+1 took no splat; the floor reads the tile a tick starts on, so S+2 is the earliest onset that capture allows; amounts copy the flood", STRATEGIES, vod("V2", "k48 to k49")),
  "outer-rule": selected<FloorRule>({ kind: "damages", afterOnset: span(5), perTick: FLOOD_PER_TICK }, "assumption", "team-5", "the flood's S+5 onset; no capture shows a player inside past one tick", NO_WIKI_P4, vod("V2", "k48 to k49")),
  harmless: selected<FloorRule>({ kind: "harmless" }, "assumption", "unscaled", "no capture shows inner-void damage", NO_WIKI_P4, vod("V2", "k48 to k49")),
});

export type HoleRule = Readonly<{ kind: "damages"; perTick: DamageRange }> | Readonly<{ kind: "harmless" }>;
type HoleLayout = Readonly<{ placement: "corner-stack" | "scattered"; tiles: readonly Tile[] }>;

type FloorHoleRecipe = Readonly<{
  lifetime: Selected<"whole-phase">;
  hiddenUnder: Selected<"outer-void">;
  look: Readonly<{ model: Selected<number>; idle: Selected<number> }>;
}>;

const HOLE_FRAMES = vod("V1", "seen G29 to G176 on 84 fitted ticks; the same tiles at t-42 (clip 0.40 s) and t-5 (clip 23.00 s)");

const FLOOR_HOLES: FloorHoleRecipe = {
  lifetime: selected("whole-phase", "footage-repeated", "team-4-and-5", "on the platform before P4 tick 0 and on the same tiles to the kill (V1) or the wipe (V2); no hole appears, moves or leaves during P4; the wiki puts void pools in phase 3", STRATEGIES, HOLE_FRAMES, vod("V2", "seen k49 to k270 on 85 fitted ticks")),
  hiddenUnder: selected("outer-void", "footage-repeated", "team-4", "V1's holes show on 0 of 99 in-view tile-ticks during the flood and 227 of 295 outside it; V2's stay visible on the strip the flood does not draw", NO_WIKI_P4, HOLE_FRAMES),
  look: {
    model: selected(62508, "inferred", "unscaled", "loc 62701 Void (tfa_ocellus_void_degen_bomb), shape 22; one tile, black starfield texture 215 in a purple rim, colour 50130; 62507 is the shape-10 twin; which shape the server spawns is unknown", NO_WIKI_PRESENTATION, cache("loc 62701 models 62507, 62508")),
    idle: selected(14891, "spec-confirmed", "unscaled", "the loc's own animation, 1.33-tick loop, no sounds", NO_WIKI_PRESENTATION, cache("loc 62701 animation 14891")),
  },
};

const HOLE_STACK_GUIDE = "https://www.youtube.com/watch?v=hR71l7hzuKM";
const scattered = (tiles: readonly Tile[]): HoleLayout => ({ placement: "scattered", tiles });

function cornerStack(platform: readonly string[], count: number): HoleLayout {
  const north = platform.findIndex((row) => row.includes("#"));
  const rows = platform.slice(north, north + count);
  const east = Math.min(...rows.map((row) => row.lastIndexOf("#")));
  return { placement: "corner-stack", tiles: rows.map((_, i) => tile(east, north + i)) };
}

const FLOOR_HOLE_LAYOUT = choice("corner-stack", {
  "corner-stack": selected<HoleLayout>(
    cornerStack(GEOMETRY.platform.value, 3),
    "community-tested",
    "unscaled",
    "void pools spawn under every player but the tank at the start of the third phase's first three quadrants, and a team that stacks on one corner tile in each quadrant leaves 3 pools in all; the guide's markers rag one tile of a 3-tile row in each quadrant, and the quarter turns carry all three onto the P4 quadrant's row, region 16472 x 43, y 37 to 39: a north-south line against the east wall, 6 tiles east of the boss's centre and 2 to 4 north; here that is the first 3 floor rows from the platform's north edge, on the easternmost column all three share, so the line sits against the brazier walkway and follows it when it moves",
    STRATEGIES_VOID_POOLS,
    guide(HOLE_STACK_GUIDE, "0:00 to 1:05 the method, 1:59 to 2:09 the 3 holes on the marked row in P4; the description's tile markers"),
    owner("picture: 3 holes in a row tucked in the corner against the brazier border", "2026-10-23"),
  ),
  "v1-turn": selected<HoleLayout>(scattered([tile(1, 5), tile(1, 6), tile(2, 8), tile(2, 9), tile(4, 9), tile(8, 5)]), "footage-repeated", "team-4", "V1's six holes carried by the quarter turn, x = 3 + v, y = 3 + u; (4, 9) is floor only on the rows that carry J1's floor south of the 5x5", NO_WIKI_ARENA, HOLE_FRAMES),
  "v1-mirror": selected<HoleLayout>(scattered([tile(5, 1), tile(6, 1), tile(8, 2), tile(9, 2), tile(9, 4), tile(5, 8)]), "footage-repeated", "team-4", "V1's six holes carried by the east-west mirror, x = 3 + u, y = 3 + v, the carry rift option A uses; (5, 1) is the player spawn, where a hole forms under a player standing there as P4 starts; (5, 8) is floor only on the rows that carry J1's floor south of the 5x5", NO_WIKI_ARENA, HOLE_FRAMES),
  "j1-mirror": selected<HoleLayout>(scattered([tile(9, 3), tile(9, 1), tile(2, 6), tile(2, 5), tile(2, 2)]), "footage-once", "unscaled", "five holes in the owner's screenshot, team of 2, mirror carry; (2, 2) is rift option A's first tile", NO_WIKI_ARENA, owner("P4 platform screenshot: five black hole blobs")),
  "j1-turn": selected<HoleLayout>(scattered([tile(3, 9), tile(1, 9), tile(6, 2), tile(5, 2), tile(2, 2)]), "footage-once", "unscaled", "the same five, quarter-turn carry; (5, 2) is a drill tile and (2, 2) is rift option A", NO_WIKI_ARENA, owner("P4 platform screenshot: five black hole blobs")),
});

const FLOOR_HOLE_DAMAGE = choice("flood-rate", {
  "flood-rate": selected<HoleRule>({ kind: "damages", perTick: FLOOD_PER_TICK }, "assumption", "unscaled", "the owner says they damage when stepped on, and the wiki's phase 3 void pools deal periodic damage; no capture shows anyone on a hole, so the amount copies the flood's 9 to 11 a tick, read on the tile a tick starts on, and a hole under a damaging flood hits as well as the flood", STRATEGIES, owner("black hole blobs damage if you step on them"), cache("loc 62701 tfa_ocellus_void_degen_bomb")),
  harmless: selected<HoleRule>({ kind: "harmless" }, "assumption", "unscaled", "no capture shows a hole's effect", NO_WIKI_P4, HOLE_FRAMES),
});

export type OuterOrbTile = Readonly<{ kind: "near-player" }> | Readonly<{ kind: "opposite-entry" }>;
type OrbVisual = "innerSpawn" | "outerSpawn" | "idle" | "despawn" | "tell" | "regain";

type LifeforceOrbRecipe = Readonly<{
  drainDivisor: Selected<number>;
  orbDistance: Selected<Readonly<{ min: number; max: number }>>;
  returnAfterStep: Selected<TickSpan>;
  returnAfterMaturing: Selected<TickSpan>;
  look: Readonly<Record<OrbVisual, Selected<number>>>;
}>;

export const spotAnim = (id: number, name: string, basis: Basis, note: string): Selected<number> =>
  selected(id, basis, "unscaled", note, NO_WIKI_PRESENTATION, cache(`spotanim ${id} ${name}`));

const LIFEFORCE_ORB: LifeforceOrbRecipe = {
  drainDivisor: selected(2, "footage-repeated", "team-4-and-5", "every player loses floor(current HP / 2); no overhead prayer reduces it", STRATEGIES, vod("V1", "G37 through Protect from Magic, G68 through Melee"), vod("V2", "k52 through Magic, k112 through Missiles")),
  orbDistance: selected({ min: 2, max: 5 }, "footage-repeated", "team-4-and-5", "a dark orb 2 to 5 tiles from its player, never under the boss or on a floor hole; with no allowed floor that close, the nearest allowed tiles, because the wiki puts the orb on a safe tile and no capture shows a player that far from one (inferred)", STRATEGIES, vod("V1", "G39"), vod("V2", "k53"), ORB_OFF_HOLES),
  returnAfterStep: selected(span(1), "footage-repeated", "team-4-and-5", "returns exactly the HP that hit took, the tick after the player steps on the orb, and can pass max HP (58 to 114)", NO_WIKI_TICKS, vod("V2", "k67 then k68, k95 then k96"), vod("V1", "G51, G79")),
  returnAfterMaturing: selected(
    span(0),
    "log-repeated",
    "unscaled",
    "a player already standing on the orb gets the HP back on the tick it matures, not a tick later: 7 returns (spotanim 4314 on the player, with the heal) came at S+16, the tick the game first sends the glowing inner orb, over 4 cycles of two fights; one of those players had stood on the tile since S+14. No outer orb return came on its first ready tick, S+41: the two earliest were at S+42, which fits players who stepped on as it glowed (inferred)",
    NO_WIKI_TICKS, fightLog("L2", "inner returns at S+16 on 3 players in cycle 1 and 2 in cycle 2; outer returns at S+42 on 2 players in cycle 1"),
    fightLog("L6", "inner returns at S+16 in cycles 1 and 3; the glowing orb sent from S+16"),
  ),
  look: {
    innerSpawn: selected(
      4311,
      "footage-repeated",
      "unscaled",
      "inner orb from the lifeforce hit to its glow, 364 client cycles, about 12 ticks; it starts on the hit tick, because its chimes 12621, 12622 and 12623 sit 3.87, 7.8 and 10.8 ticks in and the clips hear them at hit + 3.9, 7.8 and 10.8; the dark orb is first seen 1 to 2 ticks after the hit",
      NO_WIKI_PRESENTATION, cache("spotanim 4311 vfx_ocellus_soul_fragment_spawn_12_ticks, seq 14915 frames 3, 40, 84 and 117"),
      vod("V1", "3:54:05.93, t15.9"),
      vod("V2", "5:20:29.03, t15.9; 5:21:09.20, t82.8"),
      vod("V2", "k53"),
      vod("V1", "G39"),
    ),
    outerSpawn: selected(
      4309,
      "footage-repeated",
      "unscaled",
      "outer orb from the lifeforce hit to its glow, 182 client cycles, about 6 ticks; it starts on the hit tick, because its chimes 12624, 12621, 12622 and 12623 sit 0.1, 1.7, 3.8 and 5.3 ticks in and the clips hear them at hit + 0.1, 1.7, 3.8 and 5.3, so the last chime plays before the glow",
      NO_WIKI_PRESENTATION, cache("spotanim 4309 vfx_ocellus_soul_fragment_spawn_6_ticks, seq 14913 frames 1, 18, 41 and 57"),
      vod("V1", "3:54:58.25, t103.1"),
    ),
    idle: spotAnim(4310, "soul_fragment_idle", "inferred", "the glowing orb, looped"),
    despawn: spotAnim(4312, "soul_fragment_despawn", "inferred", "the orb leaving its tile"),
    tell: spotAnim(4313, "soul_fragment_player_idle", "assumption", "played on the player at the lifeforce tell, where the footage shows a teal swirl; the spec pairs it with the pickup"),
    regain: spotAnim(4314, "soul_fragment_player_regain", "inferred", "the fragment returning to the player"),
  },
};

type SpinRing = Readonly<{
  count: number;
  radius: number;
  lean: number;
  halfWidth: number;
  height: number;
  radPerSec: number;
  flareSeconds: number;
  colour: string;
}>;

type ExplosionSeriesRecipe = Readonly<{
  seriesStartsAfterHit: Selected<TickSpan>;
  telegraph: Selected<number>;
  spotAnim: Selected<number>;
  spin: Selected<SpinRing>;
  dodge: Selected<Readonly<{ radius: number; attackDelayCut: TickSpan }>>;
}>;

const EXPLOSION: ExplosionSeriesRecipe = {
  seriesStartsAfterHit: selected(
    span(2),
    "log-repeated",
    "team-4-and-5",
    "sound 12638 two ticks after the lifeforce hit, before the first mark of every option, in both clips; the fight logs put the warning spotanim on every player on that tick, S+6 and S+37, in every cycle they record",
    NO_WIKI_TICKS, vod("V1", "3:54:04.77, t14"), vod("V2", "5:20:27.89, t14"),
    fightLog("L2", "spotanim 4340 on every player at S+6 and S+37, cycles 1 and 2"),
    fightLog("L6", "spotanim 4340 on every player at S+6 and S+37, cycles 1 to 4, and S+6 of cycle 5"),
  ),
  telegraph: selected(
    4340,
    "log-repeated",
    "unscaled",
    "vfx_void_chain_player_telegraph, a ring of dark purple ovals around the player's legs, played on the player as the series starts, with sound 12638, and gone by the first mark 3 ticks later; the game's warning to get ready to step",
    NO_WIKI_PRESENTATION, cache("spotanim 4340 vfx_void_chain_player_telegraph: model 62704, seq 14934 vfx_void_chain_player, 90 client cycles"),
    fightLog("L6", "on all six players at P4 +10, S+6 of cycle 1"),
    vod("V1", "3:54:04.77 to 3:54:05.6, the ring around the legs from the series start to the first mark"),
  ),
  spotAnim: selected(
    4339,
    "inferred",
    "unscaled",
    "the 3D view plays it on the marked tile from the mark tick: long thin purple shards high around the player's head close in on the tile through the first half of the tick, a purple glow fills it, and on the impact tick grey dust and spikes burst out; its 55 client cycles end before the impact tick does. The name, the lifecycle the footage shows and a render in the trainer identify it; the glow and burst staying on a tile the player left place it on the tile, not the player. Spotanim 4340 vfx_void_chain_player_telegraph is the ring of dark ovals around the player's legs from the series start (3:54:04.77) to the first mark, and spotanims 4299 to 4302 are vfx_ocellus_quadrant_bomb, another attack",
    NO_WIKI_PRESENTATION,
    cache("spotanim 4339 vfx_void_chain_explosion: model 62616, seq 14933 vfx_void_chain_explosion_full, 21 frames, 55 client cycles; 1990 of 2135 faces opaque and 145 with base alphas, none textured"),
    vod("V1", "3:54:06.40 to 3:54:07.35, shards high around the head at 6.45 to 6.55, glow on the left tile from 6.75, burst at 7.0"),
    owner("the void shards come in high over the player's head at the start of each mark, not at the feet", "2026-10-24"),
  ),
  spin: selected(
    { count: 7, radius: 0.3, lean: 0.12, halfWidth: 0.05, height: 0.85, radPerSec: 3, flareSeconds: 0.6, colour: "#5e317b" },
    "assumption",
    "unscaled",
    "seven shards stand in a ring of radius 0.3 and half width 0.05, tips 0.85 tiles up, and spin at 3 radians a second, then scale out over 0.6 seconds. The strategies page says void particles spin around every player to warn that the explosion attack is starting and the player has to keep moving. The colour is the median of the shards on four mark ticks",
    STRATEGIES_P4,
    ocellusSim("P4Views.ts:343-349"),
  ),
  dodge: selected(
    { radius: 1, attackDelayCut: span(3) },
    "community-tested",
    "unscaled",
    "community-tested, unconfirmed: stepping off the marked tile on the mark tick to a tile within 1 of it cuts the player's attack delay by 3 at the impact, never below 0, so a 5-tick Scythe or Twisted bow attacks every 2 ticks while each pulse is dodged and a 6-tick weapon every 3; a 2-tile run avoids the hit without the cut. The wiki tester's flat-3 theory, from an Elder maul that did not 2-tick; halving was the other theory",
    wiki("https://oldschool.runescape.wiki/w/Ocellus", 15379685),
    wiki("https://oldschool.runescape.wiki/w/Ocellus", 15379561),
    wiki("https://oldschool.runescape.wiki/w/The_Fractured_Archive/Strategies", 15379780),
    wiki("https://oldschool.runescape.wiki/w/The_Fractured_Archive/Strategies", 15379373),
    owner("Scythe and Twisted bow on 2-tick gaps during the explosion series in the VOD", "2026-10-22"),
  ),
};

const deathEffect = (id: number, name: string): Selected<number> =>
  selected(id, "log-repeated", "unscaled", "on the boss on the kill tick, with his death sequence", NO_WIKI_PRESENTATION, cache(`spotanim ${id} ${name}`), fightLog("L2", `spotanim ${id} on the boss at P4 +105, the kill`));

const sound = (id: number, note: string, first: Source, ...rest: Source[]): Selected<SoundId> =>
  selected(soundId(id), "footage-repeated", "team-4-and-5", note, NO_WIKI_PRESENTATION, first, ...rest, cache(`synth ${id}`));

const PRESENTATION: PresentationRecipe = {
  bossPoses: {
    idle: pose(14840, "phase3_idle", "spec-confirmed", "boss stand animation"),
    walk: pose(14849, "phase3_walk", "spec-confirmed", "boss walk animation"),
    deflectIn: pose(14863, "phase3_deflect_in", "inferred", "rise as the inner void forms, 2 ticks; name and the wiki's rise"),
    deflectLoop: pose(14864, "phase3_deflect_loop", "inferred", "hover high over the inner void, 2-tick loop, as V2 shows from k49 to k69"),
    deflectOut: pose(14865, "phase3_deflect_out", "inferred", "landing as the inner void clears, 4 ticks; the boss is on the ground again by S+23 (k71)"),
    silentDeflectIn: pose(14866, "silent deflect in", "inferred", "outer-void Deflect candidate, 2 ticks"),
    silentDeflectLoop: pose(14867, "silent deflect loop", "inferred", "outer-void Deflect candidate, 2-tick loop"),
    silentDeflectOut: pose(14868, "silent deflect out", "inferred", "outer-void Deflect candidate, 4 ticks"),
    soulFragmentStart: pose(14855, "phase3_soul_fragment_start", "inferred", "lifeforce cast, 3 ticks; 3 + 1 ticks matches the tell-to-hit gap"),
    soulFragmentEnd: pose(14856, "phase3_soul_fragment_end", "inferred", "lifeforce cast end, 1 tick"),
    prayerIn: pose(14869, "phase3_prayer_in", "inferred", "overhead switch, 5.6 ticks"),
    prayerLoop: pose(14870, "phase3_prayer_loop", "inferred", "overhead switch loop, 3 ticks"),
    prayerOut: pose(14871, "phase3_prayer_out", "inferred", "overhead switch end, 1.5 ticks"),
    meleeHybrid: pose(14844, "phase3_melee_hybrid", "inferred", "transition attack cast at each tell, 7 ticks; its melee, magic and ranged spotanims match the three tells"),
    meleePrayer: pose(14845, "phase3_melee_prayer", "inferred", "transition attack candidate, 3 ticks"),
    unleashIn: pose(14857, "phase3_unleash_in", "inferred", "transition attack candidate, 2 ticks"),
    unleashLoop: pose(14858, "phase3_unleash_loop", "inferred", "transition attack candidate, 2-tick loop"),
    unleashOut: pose(14861, "phase3_unleash_out", "inferred", "transition attack candidate, 4 ticks"),
    death: selected(
      14872,
      "log-repeated",
      "unscaled",
      "the boss's death, played on the tick his HP reaches 0 in both logged kills",
      NO_WIKI_PRESENTATION, cache("seq 14872 npc_ocellus_phase3_death, keyframes 0 to 440"),
      fightLog("L1", "anim 14872 at P4 +121, the kill"),
      fightLog("L2", "anim 14872 at P4 +105, the kill"),
    ),
  },
  deathEffects: {
    burst: deathEffect(4274, "vfx_ocellus_death"),
    skirt: deathEffect(4275, "vfx_ocellus_death_skirt_spotanim01"),
    crack: deathEffect(4276, "vfx_ocellus_death_crack_spotanim01"),
  },
  deathLasts: selected(
    span(15),
    "inferred",
    "unscaled",
    "his body stays on the platform until the death sequence ends: its 440 client cycles are 14.7 ticks, and in one logged kill the next NPC appears on his tile 14 ticks after it",
    NO_WIKI_PRESENTATION, cache("seq 14872 keyframes 0 to 440"),
    fightLog("L2", "anim 14872 at P4 +105, npc 16683 on his tile at P4 +119"),
  ),
  levitation: selected(
    { spotAnim: 4316, during: "inner-void" },
    "log-repeated",
    "unscaled",
    "vfx_ocellus_soul_fragment_ocellus_levitating_idle, 2 ticks, on the boss on the tick of the inner void's lifeforce hit, S+4, in every cycle two fight logs record, and never at the outer void's",
    NO_WIKI_PRESENTATION, cache("spotanim 4316 vfx_ocellus_soul_fragment_ocellus_levitating_idle: seq 14920, 60 client cycles"),
    fightLog("L6", "spotanim 4316 on the boss at S+4 of cycles 1 to 5"),
    fightLog("L2", "spotanim 4316 on the boss at S+4 of cycles 1 and 2"),
  ),
  deflectWind: selected(
    4322,
    "inferred",
    "unscaled",
    "vfx_ocellus_deflect_wind_spotanim_01, 2 ticks, played on the player when Deflect turns away their hit; L1 to L8 never show it, though three log every spotanim on the players, so the id comes from ocellus-sim; it plays it at each lifeforce hit, which those logs rule out, so the deflected hit is inferred from the name",
    NO_WIKI_PRESENTATION, cache("spotanim 4322 vfx_ocellus_deflect_wind_spotanim_01: model 62676, 65 client cycles"),
    ocellusSim("fight/data.ts:152 SPOT.deflectWind; fight/phase4.ts:216 plays it on the player at each lifeforce hit"),
  ),
  sounds: {
    endShout: sound(12490, "the \"End...\" shout at t5, three ticks before the first inner void, in both clips; no sequence references it, so the server sends it", vod("V1", "3:53:59.39, t5.0"), vod("V2", "5:20:22.50, t5.0")),
    flood: sound(12497, "the outer flood at S + 31, five ticks before the floor hurts; heard in 1 V1 and 2 V2 floods, and 4 of 7 floods beat the null; the server sends it", vod("V1", "3:54:55.81, t99.0"), vod("V2", "5:20:42.89, t39.0")),
    explosionSeriesStart: sound(12638, "starts each explosion series, in 5 V1 and 5 V2 voids; no sequence references it, so the server sends it", vod("V1", "3:54:04.77, t14"), vod("V2", "5:20:27.89, t14")),
    explosionMark: sound(12537, "one per explosion mark, six per void every 2 ticks from hit + 5, in 3 V1 and 3 V2 cycles", vod("V1", "3:54:06.58, t17"), vod("V2", "5:20:29.70, t17")),
    meleeTell: sound(12572, "the melee transition tell, in all 5 melee attacks and none of the other 7; no sequence references it, so the server sends it", vod("V1", "3:54:32.45, t60.1")),
    meleeHit: sound(12567, "the melee transition hit, in all 5 melee attacks and none of the other 7; the server sends it", vod("V1", "3:54:18.66, t37.1")),
    rangedBeforeHit: sound(12555, "before the ranged transition hit, in all 4 ranged attacks, scoring at most 0.21 in the other styles; the server sends it", vod("V1", "3:54:54.23, t96.4"), vod("V2", "5:20:58.27, t64.6")),
    rangedHit: sound(12556, "the ranged transition hit, in 3 of 4 ranged attacks; the server sends it", vod("V1", "t97.1, t157.1"), vod("V2", "t65.3")),
    orbReturn: selected(
      soundId(5281),
      "inferred",
      "unscaled",
      "a heal sound played as the orb returns the player's HP; L1 to L8 record no sounds and the cache names none for it, so the id comes from ocellus-sim, which plays it when the boss absorbs an unclaimed orb; the pickup cue is inferred",
      NO_WIKI_PRESENTATION, cache("synth 5281"),
      ocellusSim("fight/data.ts:183 SOUND.heal; fight/phase4.ts:279 plays it at the boss as an unclaimed orb heals him"),
    ),
    magicWindUp: sound(12554, "the magic transition wind-up, in 3 of 3 magic attacks, scoring at most 0.09 in the other styles; the server sends it", vod("V2", "5:20:39.13, t32.7")),
  },
  soundPlayback: selected({ volume: 0.1, range: 31, retain: 31 }, "inferred", "unscaled", "played as area sounds on the player's tile, so they share the area-sound toggle with the boss; range and retain copy the boss's own frame sounds and volume the SDK's level for them, because the clips cannot show the server's values", NO_WIKI_PRESENTATION, cache("seq 14863 frame sound 12613 location 31, retain 31")),
  landingBeforeInnerClears: selected(span(1), "footage-repeated", "team-4-and-5", "the landing's frame sounds 12584, 12587, 12586 and 12585 at S+21.1, S+21.8, S+23.0 and S+23.5 put its start at S+21, a tick before the inner void clears; 12586 is heard in 3 V1 and 3 V2 cycles", NO_WIKI_TICKS, vod("V1", "3:54:15.01, t31.0"), vod("V2", "5:20:38.13, t31.0"), cache("seq 14865 frames 3, 25, 61 and 74")),
  transitionTells: {
    vortex: selected(4329, "inferred", "unscaled", "a purple starburst over the footprint, then a purple-rimmed ring about 7 tiles across", NO_WIKI_PRESENTATION, cache("spotanim 4329 phase3_melee_hybrid_magic"), vod("V2", "k72 to k78")),
    "spike-disk": selected(4330, "inferred", "unscaled", "a dark disk with purple spikes radiating toward the players", NO_WIKI_PRESENTATION, cache("spotanim 4330 phase3_melee_hybrid_ranged"), vod("V2", "k100 to k106")),
    "black-disk": selected(4328, "inferred", "unscaled", "a purple semicircle, then a disk over the footprint", NO_WIKI_PRESENTATION, cache("spotanim 4328 phase3_melee_hybrid"), vod("V2", "k132 to k137")),
  },
  tellCentre: selected(
    { faceColour: 4, rgb: 0x020203 },
    "inferred",
    "unscaled",
    "the three tells share model 62698, whose centre is 144 faces of colour 4 textured with 215, a near-black starfield; the SDK draws spotanims without textures, so those faces show their lighting as near white, and recolouring colour 4 to the texture's mean texel draws them black as the footage does. The 296 untextured colour-4 faces were already near black",
    NO_WIKI_PRESENTATION, cache("model 62698 faces of colour 4 with texture 215"),
    cache("texture 215 sprite 8803, mean texel #020203"),
    vod("V2", "k72 to k78, k100 to k106, k132 to k137"),
  ),
  overheadIcons: {
    "deflect-melee": headIcon(15, "a sword over a purple badge with blue arrows; 25 of the 168 icon detections in both clips match this frame, each closer to it than to the arrowless Dampen frames 12 and 13", DEFLECT_MELEE_SEEN),
    "deflect-range": headIcon(16, "an arrow over the same badge; 96 of the 168 icon detections in both clips match this frame, each closer to it than to the arrowless Dampen frames 12 and 13", DEFLECT_RANGE_SEEN),
    "soul-split": headIcon(11, "a white star with red arrows over a purple badge; 47 of the 168 icon detections in both clips match this frame", SOUL_SPLIT_SEEN),
  },
  overheadIconBelowHpBar: selected(7, "inferred", "unscaled", "the boss's HP bar sits above its curse icon, not over it as the SDK draws player overheads; 7 px clears the bar at the SDK's overhead scale", NO_WIKI_PRESENTATION, vod("V2", "k60, k71, k73, k80, k90")),
};

const OSRS_WIKI = "https://oldschool.runescape.wiki/w/";
const INQUISITOR_SET = wiki(`${OSRS_WIKI}Inquisitor%27s_armour`, null);
const TWISTED_BOW_PAGE = wiki(`${OSRS_WIKI}Twisted_bow`, 15363157);
const RALOS_PAGE = wiki(`${OSRS_WIKI}Tonalztics_of_ralos`, 15368852);
const SCYTHE_PAGE = wiki(`${OSRS_WIKI}Scythe_of_Vitur`, 15372833);
const RUPTURE_PAGE = wiki(`${OSRS_WIKI}Necklace_of_rupture`, 15264776);
const ANGUISH_PAGE = wiki(`${OSRS_WIKI}Necklace_of_anguish`, 15301384);
const RANCOUR_PAGE = wiki(`${OSRS_WIKI}Amulet_of_rancour`, 15343231);
const TREADS_PAGE = wiki(`${OSRS_WIKI}Avernic_treads_(max)`, 15320239);
const MASORI_MASK_PAGE = wiki(`${OSRS_WIKI}Masori_mask_(f)`, 15190975);
const MASORI_BODY_PAGE = wiki(`${OSRS_WIKI}Masori_body_(f)`, 15190976);
const MASORI_CHAPS_PAGE = wiki(`${OSRS_WIKI}Masori_chaps_(f)`, 15190977);
const ZARYTE_VAMBRACES_PAGE = wiki(`${OSRS_WIKI}Zaryte_vambraces`, 15190607);
const RAID_INVENTORY = wiki(`${OSRS_WIKI}The_Fractured_Archive/Strategies`, 15378756);
const RANGED_SWITCH = wiki(`${OSRS_WIKI}The_Fractured_Archive/Strategies`, 15379033);
const RANGED_PAGE = wiki(`${OSRS_WIKI}Ranged`, 15373088);
const BLOWPIPE_PAGE = wiki(`${OSRS_WIKI}Toxic_blowpipe`, 15376390);
const DRAGON_DART_PAGE = wiki(`${OSRS_WIKI}Dragon_dart`, 15372145);
const OCELLUS_FIGHT_PAGE = wiki(`${OSRS_WIKI}Ocellus`, 15383870);
const BLOWPIPE_STRATEGIES = wiki(`${OSRS_WIKI}The_Fractured_Archive/Strategies`, 15383713);

type Five = readonly [stab: number, slash: number, crush: number, magic: number, range: number];
const stats = (attack: Five, defence: Five, other: readonly [meleeStrength: number, rangedStrength: number, magicDamage: number, prayer: number]): ItemStats => ({
  attack: { stab: attack[0], slash: attack[1], crush: attack[2], magic: attack[3], range: attack[4] },
  defence: { stab: defence[0], slash: defence[1], crush: defence[2], magic: defence[3], range: defence[4] },
  other: { meleeStrength: other[0], rangedStrength: other[1], magicDamage: other[2], prayer: other[3] },
});
const item = (itemId: number, page: string, oldid: number, itemStats: ItemStats): TrainerItem => ({
  itemId: selected(itemId, "spec-single", "unscaled", "infobox item id", wiki(`${OSRS_WIKI}${page}`, oldid)),
  stats: selected(itemStats, "spec-single", "unscaled", "infobox combat bonuses", wiki(`${OSRS_WIKI}${page}`, oldid)),
});
const sdkIcon = (itemId: number, page: WikiRef): Selected<number> =>
  selected(itemId, "spec-single", "unscaled", "infobox item id of an SDK item whose inventory icon the trainer draws from cache 2746; the SDK's bundled Masori body (f) image matches the wiki's 2022 upload and differs from the cache render in 107 pixels", page, cache(`item ${itemId} inventory model`));

const tierItem = (id: number, name: string, simulation: TierItem["simulation"], page: string, oldid: number, note = "infobox item id"): Selected<TierItem> =>
  selected({ id, name, simulation }, "spec-single", "unscaled", note, wiki(`${OSRS_WIKI}${page}`, oldid));

const TIER_ITEMS = {
  inquisitorsGreatHelm: tierItem(24419, "Inquisitor's great helm", "simulated", "Inquisitor%27s_great_helm", 15352822),
  inquisitorsHauberk: tierItem(24420, "Inquisitor's hauberk", "simulated", "Inquisitor%27s_hauberk", 15352823),
  inquisitorsPlateskirt: tierItem(24421, "Inquisitor's plateskirt", "simulated", "Inquisitor%27s_plateskirt", 15352824),
  oathplateHelm: tierItem(30750, "Oathplate helm", "simulated", "Oathplate_helm", 15378889),
  oathplateChest: tierItem(30753, "Oathplate chest", "simulated", "Oathplate_chest", 15378890),
  oathplateLegs: tierItem(30756, "Oathplate legs", "simulated", "Oathplate_legs", 15378891),
  magmaHelm: tierItem(13199, "Magma helm", "simulated", "Magma_helm", 15276020),
  voidMeleeHelm: tierItem(11665, "Void melee helm", "simulated", "Void_melee_helm", 15260466),
  voidRangerHelm: tierItem(11664, "Void ranger helm", "simulated", "Void_ranger_helm", 15260468),
  eliteVoidTop: tierItem(13072, "Elite void top", "simulated", "Elite_void_top", 15260476),
  eliteVoidRobe: tierItem(13073, "Elite void robe", "simulated", "Elite_void_robe", 15260481),
  voidKnightGloves: tierItem(8842, "Void knight gloves", "simulated", "Void_knight_gloves", 15304461),
  eclipseMoonChestplate: tierItem(29004, "Eclipse Moon chestplate", "simulated", "Eclipse_Moon_chestplate", 15354977),
  eclipseMoonTassets: tierItem(29007, "Eclipse Moon tassets", "simulated", "Eclipse_Moon_tassets", 15354995),
  infernalCape: tierItem(21295, "Infernal cape", "simulated", "Infernal_cape", 15359317),
  amuletOfRancour: tierItem(29801, "Amulet of rancour", "simulated", "Amulet_of_rancour", 15343231),
  amuletOfBloodFury: tierItem(24780, "Amulet of blood fury", "simulated", "Amulet_of_blood_fury", 15355928),
  necklaceOfRupture: tierItem(33639, "Necklace of rupture", "simulated", "Necklace_of_rupture", 15379787),
  necklaceOfAnguishOr: tierItem(22249, "Necklace of anguish (or)", "simulated", "Necklace_of_anguish_(or)", 15188731),
  seekingDragonArrow: tierItem(33595, "Seeking dragon arrow", "simulated", "Seeking_dragon_arrow", 15314450, "infobox item id; the SDK draws it as Dragon arrow 11212 and does not simulate its minimum hit of 3"),
  tonalzticsOfRalos: tierItem(28922, "Tonalztics of Ralos", "simulated", "Tonalztics_of_Ralos", 15368852),
  dragonWarhammer: tierItem(13576, "Dragon warhammer", "simulated", "Dragon_warhammer", 15362680),
  soulreaperAxeOrnament: tierItem(33335, "Soulreaper axe (o)", "simulated", "Soulreaper_axe_(o)", 15273151, "infobox item id; the high tier's ornamented axe, which the graphic's icon shows"),
  obligator: tierItem(34715, "Obligator", "simulated", "Obligator", 15386629, "infobox id of the charged Obligator; Thrust's reach onto two more targets behind the first is not simulated"),
  ascensionCrossbows: tierItem(34681, "Ascension crossbows", "simulated", "Ascension_crossbows", 15385929),
  diamondAscensionBoltsE: tierItem(34696, "Diamond ascension bolts (e)", "simulated", "Diamond_ascension_bolts_(e)", 15383819),
  emberlight: tierItem(29589, "Emberlight", "simulated", "Emberlight", 15358485),
  twistedBow: tierItem(20997, "Twisted bow", "simulated", "Twisted_bow", 15363157),
  toxicBlowpipe: tierItem(12926, "Toxic blowpipe", "simulated", "Toxic_blowpipe", 15376390, "infobox item id; the sim's blowpipe is charged with dragon darts, Ranged strength +20 and +35"),
  zaryteCrossbow: tierItem(26374, "Zaryte crossbow", "simulated", "Zaryte_crossbow", 15382611),
  dragonCrossbow: tierItem(21902, "Dragon crossbow", "simulated", "Dragon_crossbow", 15352978),
  scorchingBow: tierItem(29591, "Scorching bow", "simulated", "Scorching_bow", 15317455),
  bookOfTheDead: tierItem(25818, "Book of the Dead", "simulated", "Book_of_the_Dead", 15317141),
  ghommalsAvernicDefender6: tierItem(27552, "Ghommal's avernic defender 6", "simulated", "Ghommal%27s_avernic_defender_6", 15324597),
  twistedBuckler: tierItem(21000, "Twisted buckler", "simulated", "Twisted_buckler", 15188072),
  ferociousGloves: tierItem(22981, "Ferocious gloves", "simulated", "Ferocious_gloves", 15301367),
  barrowsGloves: tierItem(7462, "Barrows gloves", "simulated", "Barrows_gloves", 15322401),
  zaryteVambraces: tierItem(26235, "Zaryte vambraces", "simulated", "Zaryte_vambraces", 15190607),
  avernicTreadsMax: tierItem(31097, "Avernic treads (max)", "simulated", "Avernic_treads_(max)", 15320239),
  dragonBoots: tierItem(11840, "Dragon boots", "simulated", "Dragon_boots", 15364734),
  ultorRing: selected<TierItem>(
    { id: 25485, name: "Ultor ring", simulation: "simulated" },
    "assumption",
    "unscaled",
    "the wiki's Ultor ring is item 28307; the SDK's Ultor ring class carries id 25485, which names no wiki item, with the wiki's bonuses, so the loadout holds 25485",
    wiki(`${OSRS_WIKI}Ultor_ring`, 15191287),
  ),
  berserkerRingI: tierItem(11773, "Berserker ring (i)", "simulated", "Berserker_ring_(i)", 15345632, "infobox item id of the Nightmare Zone imbue, whose icon and bonuses the Soul Wars and Emir's Arena imbues 25264 and 26770 share"),
  lightbearer: tierItem(25975, "Lightbearer", "simulated", "Lightbearer", 15299656),
  blessedDizanasQuiver: tierItem(28955, "Blessed Dizana's quiver", "simulated", "Blessed_Dizana%27s_quiver", 15357222),
  masoriMaskF: tierItem(27235, "Masori mask (f)", "simulated", "Masori_mask_(f)", 15190975),
  masoriBodyF: tierItem(27238, "Masori body (f)", "simulated", "Masori_body_(f)", 15190976),
  masoriChapsF: tierItem(27241, "Masori chaps (f)", "simulated", "Masori_chaps_(f)", 15190977),
  rangingPotion: tierItem(2444, "Ranging potion", "simulated", "Ranging_potion", 15293943),
  divineSuperCombatPotion: tierItem(23685, "Divine super combat potion", "simulated", "Divine_super_combat_potion", 15331555),
  superCombatPotion: tierItem(12695, "Super combat potion", "simulated", "Super_combat_potion", 15281186),
  superRestore: tierItem(3024, "Super restore", "simulated", "Super_restore", 15183989),
  saradominBrew: tierItem(6685, "Saradomin brew", "simulated", "Saradomin_brew", 15322175),
  allianceLog: tierItem(34729, "Alliance log", "simulated", "Alliance_log", 15383767),
  leftovers: tierItem(34730, "Leftovers", "simulated", "Leftovers", 15386167),
  prayerPotion4: tierItem(2434, "Prayer potion(4)", "simulated", "Prayer_potion", 15374387),
  prayerPotion2: tierItem(141, "Prayer potion(2)", "simulated", "Prayer_potion", 15374387),
  rangingPotion2: tierItem(171, "Ranging potion(2)", "simulated", "Ranging_potion", 15293943),
  superCombatPotion2: tierItem(12699, "Super combat potion(2)", "simulated", "Super_combat_potion", 15281186),
  mantaRay: tierItem(391, "Manta ray", "simulated", "Manta_ray", 15184402),
  halibut: tierItem(32336, "Halibut", "simulated", "Halibut", 15352002),
  giantKrill: tierItem(32312, "Giant krill", "simulated", "Giant_krill", 15351996),
  sanfewSerum: tierItem(10925, "Sanfew serum", "simulated", "Sanfew_serum", 15236706),
  divineRunePouch: tierItem(27281, "Divine rune pouch", "simulated", "Divine_rune_pouch", 15359154),
} as const satisfies Readonly<Record<string, Selected<TierItem>>>;

const I = TIER_ITEMS;
const tierStart = (weapon: StartWeapon, set: string | null, held: Selected<TierItem>, ...armour: Selected<TierItem>[]): TierStart => ({
  weapon,
  label: set === null ? held.value.name : `${held.value.name} (${set})`,
  wear: [held, ...armour].map(({ value }) => value.id),
});
const TIER_GRAPHIC = [
  noWiki("a community gear graphic, not game data"),
  owner("five gear tier screenshots; worn gear solved against each stats panel, the bag read row by row", "2026-10-25"),
  owner("use the icons where the icon and the stats panel disagree", "2026-10-28"),
  owner("High's ornamented weapon is a Soulreaper axe, not a Dragon warhammer; the Obligator and Ascension crossbows count as max gear; the rest of the tiers are right", "2026-10-30"),
] as const;
const gearTier = (recipe: TierRecipe, note: string): Selected<TierRecipe> =>
  selected(recipe, "inferred", "unscaled", `the worn melee setup and the bag four slots a row; an empty slot is one of the graphic's role squares for other bosses; ${note}`, ...TIER_GRAPHIC);

const TIERS_GEAR: GearRecipe["tiers"] = {
  max: gearTier(
    {
      label: "Max",
      equipment: { weapon: I.tonalzticsOfRalos, offhand: I.bookOfTheDead, helmet: I.inquisitorsGreatHelm, chest: I.inquisitorsHauberk, legs: I.inquisitorsPlateskirt, gloves: I.ferociousGloves, cape: I.infernalCape, necklace: I.amuletOfRancour, feet: I.avernicTreadsMax, ring: I.ultorRing, ammo: I.seekingDragonArrow },
      inventory: [
        I.zaryteCrossbow, I.zaryteVambraces, I.blessedDizanasQuiver, I.masoriMaskF,
        I.necklaceOfRupture, I.masoriBodyF, I.masoriChapsF, I.lightbearer,
        I.toxicBlowpipe, I.twistedBow, I.rangingPotion, I.rangingPotion,
        I.obligator, null, I.divineSuperCombatPotion, I.superCombatPotion,
        I.ascensionCrossbows, I.diamondAscensionBoltsE, I.superRestore, I.superRestore,
        I.saradominBrew, I.saradominBrew, I.superRestore, I.superRestore,
        I.saradominBrew, I.saradominBrew, I.sanfewSerum, I.divineRunePouch,
      ],
      starts: [
        tierStart("twistedBow", "Masori", I.twistedBow, I.masoriMaskF, I.masoriBodyF, I.masoriChapsF, I.zaryteVambraces, I.necklaceOfRupture),
        tierStart("blowpipe", "Masori", I.toxicBlowpipe, I.masoriMaskF, I.masoriBodyF, I.masoriChapsF, I.zaryteVambraces, I.necklaceOfRupture),
        tierStart("ralos", "Inquisitor's", I.tonalzticsOfRalos),
      ],
    },
    "the head is the icon's Inquisitor's great helm, where the panel sums only with a Torva full helm; the potion beside the ranging potion is lighter blue and read as a second ranging potion; the Divine rune pouch is inferred from a four-rune overlay; the Obligator takes the Sanguine scythe's square and the Ascension crossbows and Diamond ascension bolts (e) two empty squares (inferred 2026-10-30 from the owner's note and the example max setup on the wiki's Strategies page, revision 15386591, which ranks the Obligator over the scythe; one square stays empty so a two-handed start has room for the Book of the Dead): the Zaryte crossbow keeps the quiver's ruby dragon bolts (e), and the ascension bolts are worn to fire the crossbows",
  ),
  high: gearTier(
    {
      label: "High",
      equipment: { weapon: I.dragonWarhammer, offhand: I.bookOfTheDead, helmet: I.oathplateHelm, chest: I.oathplateChest, legs: I.oathplateLegs, gloves: I.barrowsGloves, cape: I.infernalCape, necklace: I.amuletOfBloodFury, feet: I.avernicTreadsMax, ring: I.ultorRing, ammo: I.seekingDragonArrow },
      inventory: [
        I.dragonCrossbow, I.masoriBodyF, I.blessedDizanasQuiver, I.divineRunePouch,
        I.necklaceOfRupture, I.masoriChapsF, I.twistedBuckler, I.soulreaperAxeOrnament,
        I.scorchingBow, I.toxicBlowpipe, I.superCombatPotion, I.superCombatPotion,
        null, null, I.rangingPotion, I.rangingPotion,
        null, null, I.superRestore, I.superRestore,
        I.saradominBrew, I.saradominBrew, I.superRestore, I.superRestore,
        I.saradominBrew, I.saradominBrew, I.superRestore, I.sanfewSerum,
      ],
      starts: [tierStart("blowpipe", "Masori", I.toxicBlowpipe, I.masoriBodyF, I.masoriChapsF, I.necklaceOfRupture)],
    },
    "every worn slot's icon agrees with the panel; the ornamented weapon in row 2 is the Soulreaper axe (o), which the owner confirmed",
  ),
  mid: gearTier(
    {
      label: "Mid",
      equipment: { weapon: I.emberlight, offhand: I.ghommalsAvernicDefender6, helmet: I.oathplateHelm, chest: I.oathplateChest, legs: I.oathplateLegs, gloves: I.barrowsGloves, cape: I.infernalCape, necklace: I.amuletOfRancour, feet: I.avernicTreadsMax, ring: I.ultorRing, ammo: I.seekingDragonArrow },
      inventory: [
        I.dragonCrossbow, I.masoriBodyF, I.blessedDizanasQuiver, I.twistedBuckler,
        I.necklaceOfAnguishOr, I.masoriChapsF, I.masoriMaskF, I.divineRunePouch,
        I.scorchingBow, I.toxicBlowpipe, I.superCombatPotion, I.superCombatPotion,
        I.dragonWarhammer, null, I.rangingPotion, I.rangingPotion,
        null, null, I.superRestore, I.superRestore,
        I.saradominBrew, I.saradominBrew, I.superRestore, I.superRestore,
        I.saradominBrew, I.saradominBrew, I.sanfewSerum, I.bookOfTheDead,
      ],
      starts: [tierStart("blowpipe", "Masori", I.toxicBlowpipe, I.masoriMaskF, I.masoriBodyF, I.masoriChapsF)],
    },
    "every worn slot's icon agrees with the panel",
  ),
  low: gearTier(
    {
      label: "Low",
      equipment: { weapon: I.emberlight, offhand: I.ghommalsAvernicDefender6, helmet: I.magmaHelm, chest: I.eclipseMoonChestplate, legs: I.eclipseMoonTassets, gloves: I.barrowsGloves, cape: I.infernalCape, necklace: I.amuletOfBloodFury, feet: I.dragonBoots, ring: I.berserkerRingI, ammo: I.seekingDragonArrow },
      inventory: [
        I.dragonCrossbow, null, I.blessedDizanasQuiver, I.divineRunePouch,
        I.necklaceOfAnguishOr, null, I.twistedBuckler, I.bookOfTheDead,
        I.scorchingBow, I.toxicBlowpipe, I.superCombatPotion, I.superCombatPotion,
        I.dragonWarhammer, null, I.rangingPotion, I.rangingPotion,
        null, null, I.superRestore, I.superRestore,
        I.saradominBrew, I.saradominBrew, I.superRestore, I.superRestore,
        I.saradominBrew, I.saradominBrew, I.superRestore, I.sanfewSerum,
      ],
      starts: [tierStart("blowpipe", null, I.toxicBlowpipe)],
    },
    "the body, boots and ring are the icons' Eclipse Moon chestplate, Dragon boots and Berserker ring (i), where the panel sums only with Masori body (f), Avernic treads (max) and an Ultor ring",
  ),
  poor: gearTier(
    {
      label: "Poor",
      equipment: { weapon: I.emberlight, offhand: I.ghommalsAvernicDefender6, helmet: I.voidMeleeHelm, chest: I.eliteVoidTop, legs: I.eliteVoidRobe, gloves: I.voidKnightGloves, cape: I.infernalCape, necklace: I.amuletOfBloodFury, feet: I.dragonBoots, ring: I.berserkerRingI, ammo: I.seekingDragonArrow },
      inventory: [
        I.dragonCrossbow, I.voidRangerHelm, I.blessedDizanasQuiver, I.divineRunePouch,
        I.necklaceOfAnguishOr, I.twistedBuckler, I.toxicBlowpipe, I.bookOfTheDead,
        I.scorchingBow, I.dragonWarhammer, I.superCombatPotion, I.superCombatPotion,
        null, null, I.rangingPotion, I.rangingPotion,
        null, null, I.superRestore, I.superRestore,
        I.saradominBrew, I.saradominBrew, I.superRestore, I.superRestore,
        I.saradominBrew, I.saradominBrew, I.superRestore, I.sanfewSerum,
      ],
      starts: [tierStart("blowpipe", null, I.toxicBlowpipe, I.voidRangerHelm)],
    },
    "the boots and ring are the icons' Dragon boots and Berserker ring (i), where the panel sums only with Avernic treads (max) and an Ultor ring",
  ),
};

const GEAR: GearRecipe = {
  items: {
    inquisitorsGreatHelm: item(24419, "Inquisitor%27s_great_helm", 15352822, stats([0, 0, 10, -5, -5], [19, 10, 21, 0, 12], [6, 0, 0, 1])),
    inquisitorsHauberk: item(24420, "Inquisitor%27s_hauberk", 15352823, stats([0, 0, 16, -11, -10], [67, 55, 71, 0, 35], [4, 0, 0, 2])),
    inquisitorsPlateskirt: item(24421, "Inquisitor%27s_plateskirt", 15352824, stats([0, 0, 12, -9, -5], [42, 30, 49, 0, 22], [2, 0, 0, 2])),
    tonalzticsOfRalos: item(28922, "Tonalztics_of_ralos", 15368852, stats([0, 0, 0, 0, 115], [0, 0, 0, 0, 0], [0, 55, 0, 2])),
  },
  sdkCacheIds: {
    necklaceOfRupture: selected(33639, "spec-confirmed", "unscaled", "the SDK's class carries anguish's id 19547 as a stand-in; cache 2746 holds item 33639 with male model 61426", RUPTURE_PAGE, cache("item 33639 maleModel0 61426")),
  },
  sdkIcons: {
    masoriMaskF: sdkIcon(27235, MASORI_MASK_PAGE),
    masoriBodyF: sdkIcon(27238, MASORI_BODY_PAGE),
    masoriChapsF: sdkIcon(27241, MASORI_CHAPS_PAGE),
    zaryteVambraces: sdkIcon(26235, ZARYTE_VAMBRACES_PAGE),
  },
  blowpipe: selected<BlowpipeRecipe>(
    { itemId: 12926, rapidSpeed: 2, otherSpeed: 3, range: 5, longrangeRange: 7, rangedAttack: 30, rangedStrength: 55, ammunition: "light" },
    "spec-single",
    "unscaled",
    "charged, in PvM: Accurate and Longrange are 3 ticks, Rapid is 2; range is 5 tiles, 7 on Longrange; Ranged attack +30 and Ranged strength +20, and dragon darts add +35",
    BLOWPIPE_PAGE,
    DRAGON_DART_PAGE,
    OCELLUS_FIGHT_PAGE,
    BLOWPIPE_STRATEGIES,
    owner("keep a blowpipe for the whole fight", "2026-10-27"),
  ),
  loadout: selected<LoadoutIds>(
    {
      equipment: { weapon: 20997, offhand: null, helmet: 27235, necklace: 33639, chest: 27238, legs: 27241, feet: 31097, gloves: 26235, ring: 28310, cape: 28951, ammo: 11212 },
      inventory: [
        28922, 22325, 24419, 24420, 24421, 22981, 21295, 29801, 25485,
        12695, 2444, 6685, 3024, 12695, 2444, 6685, 3024,
        6685, 6685, 6685, 3024, 6685, 6685, 6685, 3024,
        6685, 12926, 3024,
      ],
    },
    "assumption",
    "unscaled",
    "the ranged setup worn; slot 0 Tonalztics of Ralos, the owner's special attack weapon; slots 1 to 8 the melee setup's scythe, Inquisitor's helm, hauberk and plateskirt, Ferocious gloves, Infernal cape, Amulet of rancour and Ultor ring; slots 9 to 27 the wiki's recommended raid supplies in its order, 2 super combat potions, 2 ranging potions, 10 Saradomin brews and 5 super restores, with no fish, except that the toxic blowpipe takes the last brew's slot 26, so a brew is lost and not a restore",
    RAID_INVENTORY,
    RANGED_SWITCH,
    wiki(`${OSRS_WIKI}Ranging_potion`, 15293943),
    owner("ranged setup"),
    owner("melee setup"),
    owner("special attack weapon"),
    owner("keep a blowpipe for the whole fight", "2026-10-27"),
  ),
  starts: selected<TierStarts>(
    [
      { weapon: "twistedBow", label: "Twisted bow (Masori)", wear: [20997, 27235, 27238, 27241, 26235, 28951, 33639, 28310] },
      { weapon: "blowpipe", label: "Toxic blowpipe (Masori)", wear: [12926, 27235, 27238, 27241, 26235, 28951, 33639, 28310] },
      { weapon: "melee", label: "Scythe (Inquisitor's)", wear: [22325, 24419, 24420, 24421, 22981, 21295, 29801, 25485] },
    ],
    "assumption",
    "unscaled",
    "each start wears its weapon and that setup's armour, cape, necklace and ring from the loadout, and each worn item it displaces takes the slot the new item left, so every start carries the same items; the twisted bow is the default",
    NO_WIKI_PRACTICE,
    owner("tbow start in hand or blowpipe start or melee start with tbow as default", "2026-10-28"),
  ),
  tiers: TIERS_GEAR,
  allianceSupplies: selected<SupplyStockRecipe>(
    [
      { item: I.allianceLog, quantity: 1 },
      { item: I.leftovers, quantity: 1 },
      { item: I.saradominBrew, quantity: 6 },
      { item: I.superRestore, quantity: 4 },
      { item: I.prayerPotion4, quantity: 4 },
      { item: I.prayerPotion2, quantity: 1 },
      { item: I.rangingPotion2, quantity: 1 },
      { item: I.superCombatPotion2, quantity: 1 },
      { item: I.mantaRay, quantity: 10 },
      { item: I.halibut, quantity: 5 },
      { item: I.giantKrill, quantity: 10 },
    ],
    "spec-single",
    "unscaled",
    "the Quartermaster's Alliance Supplies stock, in the shop's order; the wiki gives no prices, so each stocked item is a cap per player on top of the tier's own carried supplies, and whether the raid shares the stock across the team is not stated",
    wiki(`${OSRS_WIKI}Alliance_Supplies`, 15378420),
  ),
  twistedBow: selected({ rapidSpeed: 5, otherSpeed: 6 }, "spec-single", "unscaled", "attack speed by stance: 5 ticks on Rapid, 6 on Accurate and Longrange", TWISTED_BOW_PAGE),
  ralos: selected({ rapidSpeed: span(6), otherSpeed: span(7), range: 7, longrangeRange: 9, hits: 2, hitMaxFraction: 0.75 }, "spec-single", "unscaled", "charged, one-handed thrown: two independent hits, each 0 to 75% of the max ranged hit", RALOS_PAGE),
  division: selected({ energy: 50, accuracyFactor: 1.5, defenceDrainOfMagic: 0.125 }, "spec-single", "unscaled", "+50% accuracy; each hit that deals damage lowers Defence by 12.5% of Magic (10% before 2026-07-22) and, on NPCs, before the second roll; the drain applies as each glaive lands, so a hit the target rejects drains nothing (inferred); rounding not stated, floored (inferred)", RALOS_PAGE),
  ralosGraphics: selected(
    {
      throw: { animation: 10923, cast: 2734, glaives: [{ projectile: 2729, impact: 2732 }, { projectile: 2730, impact: 2732 }] },
      division: { animation: 10914, cast: 2725, glaives: [{ projectile: 2727, impact: 2731 }, { projectile: 2728, impact: 2733 }] },
    },
    "spec-confirmed",
    "unscaled",
    "the charged glaives' throw and Division: the wielder's sequence and spotanim, then each glaive's travel and impact spotanim; gameval names each id, and the cache pairs each spotanim with its sequence; the second regular glaive reuses the only regular impact",
    RALOS_PAGE,
    gameval("HUMAN_GLAIVE_RALOS01_CHARGED_THROW"),
    gameval("HUMAN_GLAIVE_RALOS01_CHARGED_SPECIAL"),
    gameval("VFX_GLAIVE_CHARGED_REGULAR"),
    gameval("VFX_GLAIVE_CHARGED_SPECIAL"),
    gameval("PROJANIM_GLAIVE_01_REGULAR"),
    gameval("PROJANIM_GLAIVE_02_REGULAR"),
    gameval("PROJANIM_GLAIVE_01_SPECIAL"),
    gameval("PROJANIM_GLAIVE_02_SPECIAL"),
    gameval("VFX_GLAIVE_01_IMPACT_REGULAR_01"),
    gameval("VFX_GLAIVE_01_IMPACT_SPECIAL_01"),
    gameval("VFX_GLAIVE_02_IMPACT_SPECIAL_01"),
    cache("spotanims 2725 seq 10915, 2727 seq 10910, 2728 seq 10912, 2729 seq 10911, 2730 seq 10913, 2731 seq 10918, 2732 seq 10919, 2733 seq 10920, 2734 seq 10921"),
  ),
  quiverAmmo: selected(
    { dragonCrossbow: 9242, zaryteCrossbow: 21944 },
    "inferred",
    "unscaled",
    "assumed on 2026-10-30: the community graphics do not name a second ammo stack. Max's Zaryte crossbow uses ruby dragon bolts (e); High, Mid, Low and Poor use ruby bolts (e) with their Dragon crossbow, following the Strategies ranged recommendations. The bolts occupy the carried Blessed Dizana's quiver's second stack; the worn arrows retain priority when compatible",
    wiki("https://oldschool.runescape.wiki/w/The_Fractured_Archive/Strategies", 15386591),
    TIER_GRAPHIC[1],
    TIER_GRAPHIC[2],
    wiki("https://oldschool.runescape.wiki/w/Dizana%27s_quiver", 15376019),
    wiki("https://oldschool.runescape.wiki/w/Ruby_dragon_bolts_(e)", 15274049),
  ),
  ammunition: selected({ twistedBow: "standard", tonalzticsOfRalos: "light", dragonCrossbow: "heavy", zaryteCrossbow: "heavy", ascensionCrossbows: "heavy" }, "spec-single", "unscaled", "the Twisted Bow fires dragon arrows, and arrows roll against standard ranged defence; Ralos rolls against light; crossbow bolts, the ascension crossbows' among them, roll against heavy", RANGED_PAGE, RALOS_PAGE, wiki(`${OSRS_WIKI}Ascension_crossbows`, 15385929)),
  inquisitorCrushPerMille: selected({ inquisitorsGreatHelm: 5, inquisitorsHauberk: 10, inquisitorsPlateskirt: 10 }, "spec-single", "unscaled", "crush accuracy and damage per piece; the 2026-07-22 update moved the 1% set bonus onto the hauberk and plateskirt", wiki(`${OSRS_WIKI}Inquisitor%27s_hauberk`, 15352823), wiki(`${OSRS_WIKI}Inquisitor%27s_plateskirt`, 15352824), INQUISITOR_SET),
  scytheStance: selected("jab", "spec-single", "unscaled", "Jab is the scythe's crush style; the owner wants the Scythe setup on crush", SCYTHE_PAGE, owner("melee setup")),
  scytheMaxHitsOnOneTarget: selected(3, "spec-single", "unscaled", "one hit per tile of the target's width, up to three: a 1x1 target once, 2x2 twice, 3x3 or larger three times; other 1x1 targets in the 1x3 arc take their own hit", SCYTHE_PAGE),
};

const EXPLOSION_DAMAGE: DamageRange = { min: 14, max: 16 };
const EXPLOSION_DAMAGE_NOTE = "an explosion hits 14 to 16, the amounts three fight logs record on the impact ticks apart from the floor and other attacks landing with them; this replaces 16 from one teammate splat";
const EXPLOSION_HITS = [
  fightLog("L1", "players take 14, 15 and 16 on the impact ticks S+10 to S+20 and S+41 to S+51, 2, 10 and 8 times"),
  fightLog("L2", "14, 15 and 16 on the same ticks, 5, 8 and 8 times"),
  fightLog("L6", "14, 15 and 16 on the same ticks, 16, 12 and 16 times"),
] as const;

const PRACTICE = owner("practice one mechanic at a time; a drill option, not game data");
const drill = (first: Mechanic, ...rest: Mechanic[]): Selected<Focus<Mechanic>> =>
  selected<Focus<Mechanic>>({ kind: "drill", mechanics: [first, ...rest] }, "assumption", "unscaled", "the cycle runs from the drill's start; only these mechanics act", NO_WIKI_PRACTICE, PRACTICE);

export const OCELLUS_P4 = {
  vods: VODS,
  fightLogs: FIGHT_LOGS,
  boss: BOSS,
  leadIn: LEAD_IN,
  cycle: CYCLE,
  overheads: OVERHEADS,
  deflects: DEFLECTS,
  lifeforce: LIFEFORCE,
  special: SPECIAL,
  bossHeals: BOSS_HEALS,
  rifts: RIFTS,
  geometry: GEOMETRY,
  floor: FLOOR,
  floorHoles: FLOOR_HOLES,
  lifeforceOrb: LIFEFORCE_ORB,
  explosion: EXPLOSION,
  presentation: PRESENTATION,
  gear: GEAR,
  choices: {
    setup: choice("ranged", {
      ranged: selected<WornSet>(
        { weapon: "twistedBow", helmet: "masoriMaskF", chest: "masoriBodyF", legs: "masoriChapsF", gloves: "zaryteVambraces", cape: "dizanasQuiver", necklace: "necklaceOfRupture", feet: "avernicTreadsMax", ring: "venatorRing", ammo: "dragonArrows" },
        "assumption", "unscaled", "owner-named Twisted Bow with Masori mask, body and chaps (f) in place of elite void, the armour the wiki's ranged switch now lists first; Zaryte vambraces, the wiki's first ranged gloves, replace the void knight gloves, which had no bonus but the void set effect (inferred); the owner asked for the best-in-slot ranged necklace, which the wiki names as the Necklace of rupture, and Avernic treads (max) in both setups; arrows, cape and ring are SDK items (assumption); the default because the first void's Deflect Melee leaves ranged open",
        RANGED_SWITCH, MASORI_MASK_PAGE, MASORI_BODY_PAGE, MASORI_CHAPS_PAGE, ZARYTE_VAMBRACES_PAGE, ANGUISH_PAGE, RUPTURE_PAGE, TREADS_PAGE, owner("ranged setup"), owner("ranged armour"), owner("ranged necklace"), owner("boots"),
      ),
      melee: selected<WornSet>(
        { weapon: "scytheOfVitur", helmet: "inquisitorsGreatHelm", chest: "inquisitorsHauberk", legs: "inquisitorsPlateskirt", gloves: "ferociousGloves", cape: "infernalCape", necklace: "amuletOfRancour", feet: "avernicTreadsMax", ring: "ultorRing", ammo: "dragonArrows" },
        "assumption", "unscaled", "owner-named Inquisitor's armour with the Scythe of Vitur on crush, the Amulet of rancour (the owner's first choice over blood fury; both are in cache 2746) and Avernic treads (max) in both setups; gloves, cape and ring are SDK items (assumption)",
        RANCOUR_PAGE, TREADS_PAGE, owner("melee setup"), owner("melee amulet"), owner("boots"),
      ),
    }),
    bossMaxHp: choice("cache", {
      "footage-fit": selected(5420, "inferred", "team-4-and-5", "9820 at 4 and 12020 at 5 is 2200 per player plus 1020, at the 2-player scale solo uses", noWiki("the Ocellus hitpoints table (rev 15380968) lists 9,820 at 4 and 12,020 at 5 but 5,250, not 5,420, for a team of 1 or 2"), vod("V1", "HUD 9820"), vod("V2", "HUD 12020"), SOLO_SCALE),
      cache: selected(5250, "spec-confirmed", "unscaled", "the Ocellus hitpoints table lists 5,250 after phase 1 for a team of 1 or 2, the size a solo trainer plays at, and the cache's hitpoints match; the footage's 4- and 5-player bars do not apply", BOSS_INFOBOX, cache("npc 16677 stats")),
    }),
    entryHpFraction: choice("quarter", {
      quarter: selected(0.25, "inferred", "team-4-and-5", "halfway between the two observations", NO_WIKI_P4, vod("V1", "2445 / 9820"), vod("V2", "3118 / 12020")),
      "v1-observed": selected(0.249, "footage-once", "team-4", "V1 entry bar", NO_WIKI_P4, vod("V1", "3:53:54")),
      "v2-observed": selected(0.259, "footage-once", "team-5", "V2 entry bar", NO_WIKI_P4, vod("V2", "5:20:18")),
    }),
    explosions: choice("v2-tell-then-six", {
      "wiki-six": selected<ExplosionRecipe>({ firstMarkAfterHit: span(3), count: 6, period: span(2), impactAfterMark: span(1), damage: EXPLOSION_DAMAGE }, "spec-single", "unscaled", `six marks every 2 ticks, damage a tick later; first mark from k55; ${EXPLOSION_DAMAGE_NOTE}`, STRATEGIES, vod("V2", "k55-k65, k62"), ...EXPLOSION_HITS),
      "v2-tell-then-six": selected<ExplosionRecipe>({ firstMarkAfterHit: span(5), count: 6, period: span(2), impactAfterMark: span(1), damage: EXPLOSION_DAMAGE }, "inferred", "team-4-and-5", `k55 read as a tell, marks k57 to k67 (C4); the default because sound 12537 plays at hit + 5 to hit + 15 in every void of both clips and the marks are taken to sit on it; ${EXPLOSION_DAMAGE_NOTE}`, STRATEGIES_P4, vod("V2", "k55-k67"), vod("V1", "3:54:06.58, t17"), vod("V2", "5:20:29.70, t17"), ...EXPLOSION_HITS),
    }),
    explosionDamageReduction: choice("wiki-60", {
      "wiki-60": selected(
        60,
        "spec-single",
        "unscaled",
        "the boss takes 60% less damage while the explosions are occurring: from the first mark, when the first explosion begins on the player's tile, to the last impact, when the last one deals its damage; the series start before it only signals the attack; a hit counts on the tick it lands, and each hit rounds down; the window's ends, the landing tick and the rounding are inferred; the wiki tags the figure citation needed and says it is for 5-tick weapons and may differ with attack speed, so every weapon takes it here (inferred)",
        STRATEGIES_P4,
      ),
      "wiki-50": selected(50, "spec-single", "unscaled", "the Ocellus page: Ocellus takes 50% reduced damage while the void explosions are happening; the same window, landing tick and rounding as wiki-60 (inferred)", BOSS_INFOBOX),
    }),
    specialSelection: choice("random-uniform", {
      "random-uniform": selected<SpecialSelection>({ kind: "random-uniform" }, "inferred", "unscaled", "V1 repeats melee, so no fixed rotation explains both clips (C3)", NO_WIKI_P4, vod("V1", "G62, G90"), vod("V2", "k77-k257")),
      "rotation-magic-ranged-melee": selected<SpecialSelection>({ kind: "rotation", order: ["vortex", "spike-disk", "black-disk"] }, "footage-once", "team-5", "V2 strict rotation over 7 attacks", NO_WIKI_P4, vod("V2", "k77, k105, k137, k165, k197, k225, k257")),
      "replay-v1": selected<SpecialSelection>({ kind: "replay", order: ["black-disk", "black-disk", "spike-disk", "black-disk", "spike-disk"] }, "footage-once", "team-4", "melee, melee, ranged; the last two only look like melee and ranged (Q1)", NO_WIKI_P4, vod("V1", "G62, G90, G122, G150, G182")),
      "replay-v2": selected<SpecialSelection>({ kind: "replay", order: ["vortex", "spike-disk", "black-disk", "vortex", "spike-disk", "black-disk", "vortex"] }, "footage-once", "team-5", "as V2 ran it", NO_WIKI_P4, vod("V2", "k77, k105, k137, k165, k197, k225, k257")),
    }),
    unclaimedOuterOrb: choice("heals-boss", {
      "heals-boss": selected<UnclaimedOrbRule>({ kind: "heals-boss", afterHit: span(19) }, "inferred", "team-4-and-5", "three heals 19 ticks after an outer hit; +51 equals a teammate's 51 (C17)", NO_WIKI_P4, vod("V1", "G147"), vod("V2", "k102, k222")),
      off: selected<UnclaimedOrbRule>({ kind: "off" }, "assumption", "unscaled", "the mechanism is inferred only", NO_WIKI_P4, vod("V1", "G147")),
    }),
    innerVoidFloor: INNER_VOID_FLOOR,
    floorHoleLayout: FLOOR_HOLE_LAYOUT,
    floorHoleDamage: FLOOR_HOLE_DAMAGE,
    deflect: choice("block-and-reflect", {
      "block-and-reflect": selected<DeflectRule>(
        { kind: "block", reflectPercent: 10 },
        "owner-estimated",
        "unscaled",
        "blocked as under block-at-launch, and the player takes 10% of the damage the blocked hit would have dealt, rounded down, as its own hitsplat, and nothing when that is 0; the owner named Nex's Deflect, about 10%; the wiki says Nex's Deflect Melee turns back the damage a melee hit would have dealt but gives no fraction, and the Ocellus pages name the prayers without saying what they do; the rounding is inferred",
        DEFLECT_MELEE_PAGE, BOSS_PAGE, STRATEGIES_RIFTS, owner("deflect reflects about 10%, as on Nex", "2026-10-22"),
      ),
      "block-at-launch": selected<DeflectRule>({ kind: "block", reflectPercent: 0 }, "inferred", "unscaled", "a hit of the deflected style lands as 0, judged by the overhead up when it was launched: three ranged hits launched before Deflect Range rose landed in full under it, and no capture shows a hit launched into a deflect of its own style (Q8); nothing comes back to the player", NO_WIKI_P4, vod("V1", "G182 to G184"), vod("V2", "k78 to k81, k137 to k140")),
      none: selected<DeflectRule>({ kind: "none" }, "assumption", "unscaled", "the wiki names the prayers without saying what they do", STRATEGIES),
    }),
    hoverMeleeReach: choice("unreachable", {
      unreachable: selected<HoveringBoss>("present-out-of-melee-reach", "inferred", "unscaled", "melee cannot reach the boss while he hovers, from S+0 to S+21: all 28 of Kirby's attacks in 6 hovers are ranged, every player stands off the 5x5 while he hovers, and the owner believes melee cannot reach him in the air; whether the void ring or his height stops it is not filmed", NO_WIKI_P4, vod("V1", "G33 to G54, G93 to G114, G153 to G174"), vod("V2", "k48 to k69, k108 to k129, k168 to k189"), owner("melee reach while airborne")),
      reachable: selected<HoveringBoss>("present-damageable", "assumption", "unscaled", "melee reaches the hovering boss as it reaches the landed one; no capture shows a melee attack while he hovers", NO_WIKI_P4, vod("V1", "G33 to G54, G93 to G114, G153 to G174"), vod("V2", "k48 to k69, k108 to k129, k168 to k189")),
    }),
    orbPickupRadius: choice("on-tile", {
      "on-tile": selected(0, "footage-repeated", "team-5", "the streamer stands on the orb tile a tick before each heal (C9)", STRATEGIES_P4, vod("V2", "k67, k95")),
      adjacent: selected(1, "footage-once", "team-4", "pickups read from an adjacent tile, with about 1 tile of perspective error (C9)", NO_WIKI_P4, vod("V1", "G51, G135, G175")),
    }),
    outerOrbTile: choice("opposite-entry", {
      "opposite-entry": selected<OuterOrbTile>(
        { kind: "opposite-entry" },
        "spec-single",
        "unscaled",
        "on the 5x5 rim tile farthest in a straight line from the tile where the player last stepped into the 5x5, or from the player when they are outside it at the hit, never on a hole; ties are a seeded pick; a guide says the orb is pretty much always on the opposite side of where you enter, and its frame shows the orb on the far edge",
        NO_WIKI_P4, owner("the orb opposite of where you enter", "2026-10-23"),
      ),
      "safe-floor": selected<OuterOrbTile>({ kind: "near-player" }, "footage-repeated", "team-4", "safe floor: outer orbs on the 5x5 edge, off the void and off the holes, collected without leaving the square", STRATEGIES_P4, vod("V1", "G74, G79, G128, G135"), ORB_OFF_HOLES),
    }),
    focus: choice("full-fight", {
      "full-fight": selected<Focus<Mechanic>>({ kind: "full-fight" }, "assumption", "unscaled", "every mechanic acts", NO_WIKI_PRACTICE, PRACTICE),
      "void-floor": drill("void-floor"),
      "lifeforce-orb": drill("lifeforce-orb"),
      "orb-retrieval": drill("lifeforce-orb", "void-floor"),
      explosions: drill("explosions"),
      "transition-attacks": drill("transition-attacks"),
      "boss-heals": drill("transition-attacks", "lifeforce-orb"),
      rifts: drill("rifts"),
      "floor-holes": drill("floor-holes"),
    }),
    drillStart: choice("at-mechanic", {
      "at-mechanic": selected<DrillStart>({ kind: "before-first-beat", lead: span(5) }, "assumption", "unscaled", "a drill starts 5 ticks before its first focused beat, or at tick 0 when it has none, as floor holes do; the full fight always starts at 0", NO_WIKI_PRACTICE, owner("jumping straight to a mechanic", "2026-10-22")),
      "cycle-start": selected<DrillStart>({ kind: "cycle-start" }, "assumption", "unscaled", "a drill starts at P4 tick 0 with the full fight", NO_WIKI_PRACTICE, PRACTICE),
    }),
  },
} as const;

type Choices = typeof OCELLUS_P4.choices;
type ChoiceName = keyof Choices;
type OptionsOf<K extends ChoiceName> = Choices[K]["options"];
type OptionKey<K extends ChoiceName> = keyof OptionsOf<K> & string;
const SCATTERED = "scattered";
export type DrillSelection = { readonly [K in Exclude<ChoiceName, "floorHoleLayout">]?: OptionKey<K> } & Readonly<{ floorHoleLayout?: OptionKey<"floorHoleLayout"> | typeof SCATTERED }>;
const CHOICES: { readonly [K in ChoiceName]: Readonly<{ default: OptionKey<K>; options: OptionsOf<K> }> } = OCELLUS_P4.choices;

class ResolvedChoice<K extends ChoiceName> {
  readonly #name: K;
  readonly option: OptionsOf<K>[OptionKey<K>];

  constructor(name: K, readonly key: OptionKey<K>) {
    this.#name = name;
    this.option = CHOICES[name].options[key];
  }
}
export type ResolvedChoices = { readonly [K in ChoiceName]: ResolvedChoice<K> };

export type DrillConfig = Readonly<{ seed: Seed; choices: ResolvedChoices; bossEntryHp: number | null }>;
type ParsedDrill = Readonly<{ config: DrillConfig; invincible: boolean; rejected: readonly string[] }>;

function hasKey<O extends object>(record: O, key: string): key is keyof O & string {
  return Object.prototype.hasOwnProperty.call(record, key);
}

const HOLE_LAYOUTS = CHOICES.floorHoleLayout.options;
const SCATTERED_HOLE_LAYOUTS = Object.keys(HOLE_LAYOUTS).filter(
  (key): key is OptionKey<"floorHoleLayout"> => hasKey(HOLE_LAYOUTS, key) && HOLE_LAYOUTS[key].value.placement === SCATTERED,
);

function scatteredHoleLayout(runSeed: Seed): OptionKey<"floorHoleLayout"> {
  return SCATTERED_HOLE_LAYOUTS[Math.floor(roll(runSeed, "holeLayout", tick(0), 0) * SCATTERED_HOLE_LAYOUTS.length)] ?? CHOICES.floorHoleLayout.default;
}

function resolveChoices(lookup: (name: ChoiceName) => string | undefined, rejected: string[], runSeed: Seed): ResolvedChoices {
  const pick = <K extends ChoiceName>(name: K): ResolvedChoice<K> => {
    const raw = lookup(name);
    const { options } = CHOICES[name];
    if (raw !== undefined && hasKey(options, raw)) return new ResolvedChoice(name, raw);
    if (raw !== undefined) rejected.push(`${name}=${raw}`);
    return new ResolvedChoice(name, CHOICES[name].default);
  };
  return {
    setup: pick("setup"),
    bossMaxHp: pick("bossMaxHp"),
    entryHpFraction: pick("entryHpFraction"),
    explosions: pick("explosions"),
    explosionDamageReduction: pick("explosionDamageReduction"),
    specialSelection: pick("specialSelection"),
    unclaimedOuterOrb: pick("unclaimedOuterOrb"),
    innerVoidFloor: pick("innerVoidFloor"),
    floorHoleLayout: lookup("floorHoleLayout") === SCATTERED ? new ResolvedChoice("floorHoleLayout", scatteredHoleLayout(runSeed)) : pick("floorHoleLayout"),
    floorHoleDamage: pick("floorHoleDamage"),
    deflect: pick("deflect"),
    hoverMeleeReach: pick("hoverMeleeReach"),
    orbPickupRadius: pick("orbPickupRadius"),
    outerOrbTile: pick("outerOrbTile"),
    focus: pick("focus"),
    drillStart: pick("drillStart"),
  };
}

function isChoiceName(name: string): name is ChoiceName {
  return hasKey(OCELLUS_P4.choices, name);
}

type SeedRead = Readonly<{ seed: Seed; rejected: string | null }>;

function readSeed(url: URL, freshSeed: () => number): SeedRead {
  const raw = url.searchParams.get("seed");
  const parsed = raw !== null && /^\d{1,10}$/.test(raw) && Number(raw) <= 0xffffffff ? Number(raw) : null;
  return { seed: seed(parsed ?? freshSeed()), rejected: raw !== null && parsed === null ? `seed=${raw}` : null };
}

function readInvincible(url: URL, rejected: string[]): boolean {
  const invincible = url.searchParams.get("invincible");
  if (invincible !== null && invincible !== "on") rejected.push(`invincible=${invincible}`);
  return invincible === "on";
}

function readBossHp(url: URL, maxHp: number, rejected: string[]): number | null {
  const raw = url.searchParams.get("bosshp");
  const bossHp = raw !== null && /^\d{1,6}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= maxHp ? Number(raw) : null;
  if (raw !== null && bossHp === null) rejected.push(`bosshp=${raw}`);
  return bossHp;
}

function rejectUnknownKeys(url: URL, known: (key: string) => boolean, rejected: string[]): void {
  for (const [key, value] of url.searchParams) {
    if (key !== "seed" && key !== "invincible" && key !== "bosshp" && !known(key)) rejected.push(`${key}=${value}`);
  }
}

/** P4 as the full fight enters it: every choice at its default, on the fight's seed. */
export function fullFightConfig(runSeed: Seed): DrillConfig {
  return { seed: runSeed, choices: resolveChoices(() => undefined, [], runSeed), bossEntryHp: null };
}

export function parseDrillRequest(url: URL, freshSeed: () => number): ParsedDrill {
  const rejected: string[] = [];
  rejectUnknownKeys(url, isChoiceName, rejected);
  const invincible = readInvincible(url, rejected);
  const run = readSeed(url, freshSeed);
  const choices = resolveChoices((name) => url.searchParams.get(name) ?? undefined, rejected, run.seed);
  if (run.rejected !== null) rejected.push(run.rejected);
  const bossEntryHp = readBossHp(url, choices.bossMaxHp.option.value, rejected);
  return { config: { seed: run.seed, choices, bossEntryHp }, invincible, rejected };
}
