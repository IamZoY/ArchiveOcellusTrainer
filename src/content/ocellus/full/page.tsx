import React, { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { CacheRender, TrainerInstance, Viewport } from "osrs-sdk";
import type { Location3, Region, TrainerLoadingState } from "osrs-sdk";
import { GameOverlay, RuneScapeButton, TrainerApp } from "osrs-sdk-react";
import { loadFixedFrame } from "../../../fixedFrame";
import { readSettings, RunGate, RunPauseButton } from "../../../runGate";
import { keepStorageUsable } from "../../../browserStorage";
import { reportUnservedAssets } from "../../../servedAssets";
import { loadWebAnalytics, startPerfTelemetry } from "../../../telemetry/perfTelemetry";
import { RunClock } from "../../../sim/sdk/RunClock";
import type { Pause } from "../../../sim/sdk/RunClock";
import type { CreditLink } from "../../../menu/credits";
import { CONTRIBUTOR, MAKER_LINKS } from "../../../menu/credits";
import Sidebar from "../../../menu/Sidebar";
import { dressStartedFight } from "../fight/blowpipe";
import { GEAR_SCOPES, OCELLUS_PRESETS, TierLoadouts, parseTier, startingLoadout, tierStart, tierStarts } from "../js/OcellusLoadout";
import type { StartWeapon, Tier, TierItem } from "../js/OcellusTimings";
import { START_WEAPONS, TIERS } from "../js/OcellusTimings";
import { LoadoutSection, useTierLoadout } from "./loadout";
import { installBossBar } from "../fight/bossBar";
import type { ChatLine, StartPhase } from "./options";
import { START_PHASES, formatTicks } from "./options";
import type { PlatformFacing } from "./fall";
import { p4CameraFacing } from "./fall";
import type { ATile, Quadrant } from "../fight/geometry";
import { toSdk } from "../fight/geometry";
import { warmLaterPhases } from "../fight/warmup";
import { FULL_FIGHT_CSS } from "../../../fullFightStyles";
import { useKeepChatAboveInventory } from "../../../placeChat";
import type { P4Mount } from "../js/p4/phase";
import type { RunState } from "../js/P4Types";
import type { BossForm } from "../fight/units";
import { FightPlayer } from "../fight/units";
import type { P1Mount } from "./p1/sdk/phase";
import type { P2Mount } from "./p2/sdk/phase";
import type { P3Mount } from "./p3/sdk/phase";
import type { FullFightOptions } from "./region";
import { FightRegion, START_NPC, fullFightStaged } from "./region";
import { exposeP4Probe } from "./p4Probe";
import { PRAYER_NAME, STYLE_COLOUR } from "./prayerGuide";
import { TONE_COLOUR } from "./mechanicsGuide";

declare global {
  interface Window {
    __fullFightProbe?: Readonly<{
      snapshot(): FullFightSnapshot;
      tileCentre(at: ATile): Readonly<{ x: number; y: number }> | null;
      die(): void;
      /** Sets his HP to a whole-number percentage of the pool, so a check reaches each quadrant's fall without the damage. */
      bossTo(percent: number): void;
      /** Puts the player on a tile. A click does not move them once a quadrant is collapsing. */
      place(at: ATile): void;
      /** Where this frame draws him and the player, for a capture that times their movement frame by frame. */
      drawn(): Drawn;
    }>;
  }
}

const CHAT_LINES_SHOWN = 5;

function xHandle(link: CreditLink): CreditLink {
  return { label: `@${new URL(link.href).pathname.replace(/^\//, "")}`, href: link.href };
}

const UPDATE_LINKS: readonly CreditLink[] = [
  ...MAKER_LINKS.filter((link) => new URL(link.href).host === "x.com").map(xHandle),
  xHandle(CONTRIBUTOR),
];

type Params = FullFightOptions & Readonly<{ tier: Tier; weapon: StartWeapon | null }>;

function readParams(): Params {
  const url = new URL(window.location.href);
  const get = (name: string) => url.searchParams.get(name);
  const startPhase = START_PHASES.find((phase) => String(phase) === get("phase")) ?? 4;
  const rawSeed = get("seed");
  const seed = rawSeed !== null && /^\d{1,10}$/.test(rawSeed) ? Number(rawSeed) % 4294967296 : crypto.getRandomValues(new Uint32Array(1))[0];
  const tier = parseTier(get("tier"));
  const flag = (name: string, fallback: boolean) => {
    const value = get(name);
    return value === null ? fallback : value === "1";
  };
  return {
    seed,
    party: 1,
    startPhase,
    hazardTiles: flag("tiles", true),
    videoMarkers: flag("markers", false),
    prayerGuide: flag("prayer", false),
    mechanicsGuide: flag("tells", false),
    skipMarkers: flag("skip", false),
    patternMarkers: flag("pattern", false),
    soloVine: flag("vine", true),
    invincible: flag("practice", false),
    defenceDrained: flag("drained", false),
    tier,
    weapon: START_WEAPONS.find((weapon) => weapon === get("weapon")) ?? null,
  };
}

function rememberFlag(name: string, on: boolean): void {
  const url = new URL(window.location.href);
  url.searchParams.set(name, on ? "1" : "0");
  window.history.replaceState(window.history.state, "", url.href);
}

function writeParams(params: Params, fresh = true): void {
  const url = new URL(window.location.href);
  url.searchParams.set("phase", String(params.startPhase));
  url.searchParams.delete("party");
  url.searchParams.delete("setup");
  url.searchParams.set("tier", params.tier);
  if (params.weapon === null) url.searchParams.delete("weapon");
  else url.searchParams.set("weapon", params.weapon);
  url.searchParams.set("drained", params.defenceDrained ? "1" : "0");
  url.searchParams.set("tiles", params.hazardTiles ? "1" : "0");
  url.searchParams.set("markers", params.videoMarkers ? "1" : "0");
  url.searchParams.set("prayer", params.prayerGuide ? "1" : "0");
  url.searchParams.set("tells", params.mechanicsGuide ? "1" : "0");
  url.searchParams.set("skip", params.skipMarkers ? "1" : "0");
  url.searchParams.set("pattern", params.patternMarkers ? "1" : "0");
  url.searchParams.set("vine", params.soloVine ? "1" : "0");
  url.searchParams.set("practice", params.invincible ? "1" : "0");
  if (fresh) url.searchParams.delete("seed");
  else url.searchParams.set("seed", String(params.seed));
  window.location.assign(url.href);
}

function createTrainer() {
  const saved = keepStorageUsable();
  CacheRender.configure(new URL("osrs-assets/manifest.json", window.location.href).href);
  void CacheRender.bundle().then(({ manifest }) => reportUnservedAssets(manifest), (error: unknown) => console.error("assets: osrs-assets/manifest.json did not load", error));
  readSettings();
  const link = readParams();
  const loadouts = new TierLoadouts(saved, link.tier, GEAR_SCOPES.find((scope) => scope === process.env.ARCHIVE_LOADOUT) ?? "editor");
  const started = startingLoadout(loadouts.active(), link.weapon);
  const params: Params = { ...link, weapon: started.start };
  const region = fullFightStaged(params, (player) => dressStartedFight(player, started.loadout));
  installBossBar((r: Region) => {
    if (!(r instanceof FightRegion)) return null;
    const p1 = r.current === "p1" ? r.p1.mounted : null;
    return { meter: p1 ? p1.script.meter : null, teal: p1 !== null };
  });
  loadFixedFrame();
  const trainer = new TrainerInstance(region, { readyTimer: 5 });
  const clock = new RunClock(trainer);
  loadWebAnalytics();
  void startPerfTelemetry({ world: region.world, run: () => region.p4.mounted?.ocellus.runState() ?? null, stage: () => region.rows("p4").at(-1)?.phase.stage ?? null }, clock);
  return { trainer, region, params, clock, loadouts, started };
}

function prefetchLaterPhases(start: StartPhase): void {
  const later = START_PHASES.filter((phase) => phase > start).map((phase) => START_NPC[phase]);
  const ids = [...new Set(later)].filter((npc) => npc !== START_NPC[start]).map((npc) => `npc-${npc}`);
  void CacheRender.bundle().then(async (bundle) => {
    for (const id of ids) {
      try {
        await bundle.fetchAsset(id);
      } catch {
        continue;
      }
    }
  }).catch(() => undefined);
}

type Download = Readonly<{ done: number; total: number }>;

/**
 * The SDK's splash counts only its own small files, so it sits at 100% while the cache models download. Count those
 * instead: every effect graphic (each actor model loads them all) and his first body, sized from the manifest.
 */
function useFirstDownload(start: StartPhase, active: boolean): Download | null {
  const [download, setDownload] = useState<Download | null>(null);
  useEffect(() => {
    if (!active) return;
    let observer: PerformanceObserver | null = null;
    let stopped = false;
    performance.setResourceTimingBufferSize(2000);
    void CacheRender.bundle().then((bundle) => {
      if (stopped) return;
      const sizes = new Map<string, number>();
      for (const [id, asset] of Object.entries(bundle.manifest.assets)) {
        if (id.startsWith("spotanim-") || id === `npc-${START_NPC[start]}`) sizes.set(asset.file, asset.bytes ?? 0);
      }
      const total = [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0);
      const arrived = new Set<string>();
      let done = 0;
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const file = entry.name.split("/").pop() ?? "";
          const bytes = sizes.get(file);
          if (bytes === undefined || arrived.has(file)) continue;
          arrived.add(file);
          done += bytes;
        }
        setDownload({ done, total });
      });
      observer.observe({ type: "resource", buffered: true });
      setDownload({ done, total });
    }).catch(() => undefined);
    return () => {
      stopped = true;
      observer?.disconnect();
    };
  }, [start, active]);
  return download;
}

function LoadingSplash({ state, download }: { state?: TrainerLoadingState; download: Download | null }) {
  if (state?.status === "ready") return null;
  const failed = state?.status === "error";
  const progress = download && download.total > 0 ? Math.min(1, download.done / download.total) : 0;
  const mb = (bytes: number) => Math.round(bytes / 1e6);
  return (
    <div id="trainer-loading" className="fight-loading">
      <div>{failed ? `Loading failed: ${state?.error?.message ?? "Unknown error"}` : download ? `Loading Ocellus: ${mb(download.done)} / ${mb(download.total)} MB` : "Loading Ocellus"}</div>
      {!failed && (
        <>
          <div className="fight-loading-bar">
            <div style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="fight-loading-note">The game models download once, then your browser keeps them.</div>
        </>
      )}
    </div>
  );
}

/** Phase 1, then 2 and 3, then phase 4, in one world. `from` is the fight clock on the phase's tick 0. */
type Stage =
  | Readonly<{ phase: "p1"; p1: P1Mount; from: number }>
  | Readonly<{ phase: "p2"; p2: P2Mount; from: number }>
  | Readonly<{ phase: "p3"; p3: P3Mount; from: number }>
  | Readonly<{ phase: "p4"; p4: P4Mount; from: number }>;

/** Read from what is mounted, latest phase first: the page renders before the region opens its run. */
function stageOf(region: FightRegion): Stage | null {
  const p4 = region.p4.mounted;
  if (p4) return { phase: "p4", p4, from: region.startOf("p4") };
  const p3 = region.p3.mounted;
  if (p3) return { phase: "p3", p3, from: region.startOf("p3") };
  const p2 = region.p2.mounted;
  if (p2) return { phase: "p2", p2, from: region.startOf("p2") };
  const p1 = region.p1.mounted;
  return p1 && { phase: "p1", p1, from: 0 };
}

function useStage(region: FightRegion): Stage | null {
  const [stage, setStage] = useState<Stage | null>(() => stageOf(region));
  useEffect(() => {
    const unsubscribe = region.onFightChange(() => setStage(stageOf(region)));
    setStage(stageOf(region));
    const poll = window.setInterval(() => setStage(stageOf(region)), 500);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [region]);
  return stage;
}

/** Phases 3 and 4 change on world ticks, and his fight has stopped stepping, so the page follows the region's ticks. */
function useRegionTicks(region: FightRegion): number {
  return useSyncExternalStore(
    (listener) => region.onTick(listener),
    () => region.ticks(),
  );
}

function p4Ticks(run: RunState): number {
  switch (run.kind) {
    case "waiting":
      return 0;
    case "running":
      return run.tick;
    case "ended":
      return run.at;
    default: {
      const unhandled: never = run;
      return unhandled;
    }
  }
}

function stageTicks(stage: Stage): number {
  switch (stage.phase) {
    case "p1":
      return stage.from + stage.p1.now();
    case "p2":
      return stage.from + stage.p2.now();
    case "p3":
      return stage.from + stage.p3.now();
    case "p4":
      return stage.from + p4Ticks(stage.p4.ocellus.runState());
    default: {
      const unhandled: never = stage;
      return unhandled;
    }
  }
}

function stageLabel(stage: Stage): string {
  switch (stage.phase) {
    case "p1":
      return stage.p1.started() ? "Phase 1" : "Get ready";
    case "p2":
      return stage.p2.started() ? "Phase 2" : "Get ready";
    case "p3":
      return stage.p3.started() ? "Phase 3" : "Get ready";
    case "p4":
      return "Phase 4";
    default: {
      const unhandled: never = stage;
      return unhandled;
    }
  }
}

function aimPlatformCamera(facing: PlatformFacing): void {
  const viewport = Viewport.viewport;
  if (!viewport) return;
  switch (facing) {
    case "south":
      viewport.rotateSouth();
      return;
    case "west":
      viewport.rotateWest();
      return;
    case "north":
      viewport.rotateNorth();
      return;
    case "east":
      viewport.rotateEast();
      return;
    default: {
      const unhandled: never = facing;
      return unhandled;
    }
  }
}

type DrawnChat = Readonly<{ key: string; text: string; colour: string | null }>;

function drawnChat(stage: Stage | null, history: readonly ChatLine[]): readonly DrawnChat[] {
  if (stage?.phase === "p4") {
    return stage.p4.views.chat.slice(-CHAT_LINES_SHOWN).map((text, index) => ({ key: `p4-${index}`, text, colour: null }));
  }
  return history.slice(-CHAT_LINES_SHOWN).map((line, index) => ({ key: `${line.tick}-${index}`, text: line.text, colour: line.colour }));
}

function Hud({ stage, region }: Readonly<{ stage: Stage; region: FightRegion }>) {
  useRegionTicks(region);
  const ticks = stageTicks(stage);
  const label = stageLabel(stage);
  return (
    <div className="fight-hud">
      <div className="fight-hud-phase">{label}</div>
      <div className="fight-hud-timer">{formatTicks(ticks)}</div>
      <div className="fight-hud-tick">tick {ticks}</div>
    </div>
  );
}

function Chatbox({ stage, region }: Readonly<{ stage: Stage | null; region: FightRegion }>) {
  useRegionTicks(region);
  const lines = drawnChat(stage, region.chat());
  useKeepChatAboveInventory(lines.map((line) => line.text).join("\n"));
  return (
    <ol id="game_chat">
      {lines.map((line) => (
        <li key={line.key} style={line.colour === null ? undefined : { color: line.colour }}>{line.text}</li>
      ))}
    </ol>
  );
}

function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

function ticksText(ticks: number): string {
  return ticks === 1 ? "1 tick" : `${ticks} ticks`;
}

/** The prayer guide's card: the prayer the soonest attack needs and when it lands, the tell that shows it, and the one after. */
function PrayerCard({ region }: Readonly<{ region: FightRegion }>) {
  useRegionTicks(region);
  const card = region.prayerCard();
  if (card === null) return null;
  if (card.kind === "idle") {
    return (
      <div id="prayer_guide_card" className="prayer-guide prayer-guide-idle">
        <div className="prayer-guide-why">{card.note}</div>
      </div>
    );
  }
  const { cue, inTicks } = card.now;
  const icon = region.prayerIcon(cue.style);
  const next = card.next;
  return (
    <div id="prayer_guide_card" className="prayer-guide" data-style={cue.style} style={{ borderColor: hex(STYLE_COLOUR[cue.style]) }}>
      <div className="prayer-guide-head">
        {icon !== null && <img className="prayer-guide-icon" src={icon} alt="" />}
        <div>
          <div className="prayer-guide-prayer" style={{ color: hex(STYLE_COLOUR[cue.style]) }}>{PRAYER_NAME[cue.style].replace(/^Protect from /, "Protect ").toUpperCase()}</div>
          <div className="prayer-guide-when">{`lands in ${ticksText(inTicks)}`}</div>
        </div>
      </div>
      <div className="prayer-guide-why">{`Why: ${cue.tell}`}</div>
      {cue.caution !== null && <div className="prayer-guide-caution">{cue.caution}</div>}
      {next !== null && <div className="prayer-guide-next">{`Next: ${next.cue.style} in ${ticksText(next.inTicks)}, ${next.cue.attack}`}</div>}
    </div>
  );
}

/** How many of the coming mechanics the card lists. */
const MECHANICS_SHOWN = 6;

/** The mechanics guide's card: the next few mechanics, each with its countdown and what to do. */
function MechanicsCard({ region }: Readonly<{ region: FightRegion }>) {
  useRegionTicks(region);
  const lines = region.mechanicsCard();
  if (lines === null) return null;
  return (
    <div id="mechanics_guide_card" className="mechanics-guide">
      {lines.length === 0 && <div className="mechanics-guide-todo">Nothing telegraphed is on its way.</div>}
      <ol>
        {lines.slice(0, MECHANICS_SHOWN).map((line) => (
          <li key={line.id}>
            <span className="mechanics-guide-when" style={{ color: hex(TONE_COLOUR[line.tone]) }}>{`${line.inTicks}t`}</span>
            <span className="mechanics-guide-what">{line.count > 1 ? `${line.what} ×${line.count}` : line.what}</span>
            {line.todo !== "" && <div className="mechanics-guide-todo">{line.todo}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

type Ending = Readonly<{ won: boolean; ticks: number; phase: string }>;

function endingOf(stage: Stage): Ending | null {
  switch (stage.phase) {
    case "p1": {
      const outcome = stage.p1.script.outcome;
      return outcome.kind === "running" ? null : { won: outcome.kind === "won", ticks: stage.from + outcome.at, phase: "Phase 1" };
    }
    case "p2": {
      const outcome = stage.p2.script.outcome;
      return outcome.kind === "running" ? null : { won: false, ticks: stage.from + outcome.at, phase: "Phase 2" };
    }
    case "p3": {
      const outcome = stage.p3.script.outcome;
      return outcome.kind === "running" ? null : { won: false, ticks: stage.from + outcome.at, phase: "Phase 3" };
    }
    case "p4": {
      const run = stage.p4.ocellus.runState();
      return run.kind === "ended" ? { won: run.reason === "kill", ticks: stage.from + run.at, phase: "Phase 4" } : null;
    }
    default: {
      const unhandled: never = stage;
      return unhandled;
    }
  }
}

function PausedNote({ pauses }: Readonly<{ pauses: readonly Pause[] }>) {
  if (pauses.length === 0) return null;
  const seconds = (pauses.reduce((total, pause) => total + pause.ms, 0) / 1000).toFixed(1);
  return <p id="run_result_paused">Paused {pauses.length === 1 ? "once" : `${pauses.length} times`}, for {seconds} s in all.</p>;
}

function Result({ stage, region, params, clock }: Readonly<{ stage: Stage; region: FightRegion; params: Params; clock: RunClock }>) {
  useRegionTicks(region);
  const ending = endingOf(stage);
  if (ending === null) return null;
  const now = region.currentOptions();
  const again = (fresh: boolean) => writeParams({ ...params, hazardTiles: now.hazardTiles, prayerGuide: now.prayerGuide, mechanicsGuide: now.mechanicsGuide, invincible: now.invincible, skipMarkers: now.skipMarkers, patternMarkers: now.patternMarkers }, fresh);
  return (
    <div className="fight-result">
      <h2>{ending.won ? "Ocellus defeated" : "Oh dear, you are dead!"}</h2>
      <p>
        {ending.won ? "Challenge complete" : "You fell"} after <b>{formatTicks(ending.ticks)}</b> ({ending.ticks} ticks), in {ending.phase.toLowerCase()}.
      </p>
      <PausedNote pauses={clock.pauses()} />
      <div className="fight-result-buttons">
        <RuneScapeButton id="result_restart" type="button" onClick={() => again(true)}>Try again</RuneScapeButton>
        <RuneScapeButton id="result_retry" type="button" onClick={() => again(false)}>Same seed</RuneScapeButton>
      </div>
      <p className="fight-result-follow">
        Updates and new sims:{" "}
        {UPDATE_LINKS.map((link, index) => (
          <React.Fragment key={link.href}>
            {index > 0 && " and "}
            <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
          </React.Fragment>
        ))}
        {" on X"}
      </p>
    </div>
  );
}

const START_LABEL: Readonly<Record<StartPhase, string>> = {
  1: "Phase 1 · Corners",
  2: "Phase 2 · The Blade",
  3: "Phase 3 · Quadrants",
  4: "Phase 4",
};

const TIPS: Readonly<Record<StartPhase, readonly string[]>> = {
  1: [
    "Pray Missiles for the orange fire volleys, Magic for the blue water ones. Prayer is checked when the shot lands.",
    "At each corner 7 cracks grow toward him. Stand on a closing crack to block it: it heals you instead of him. Unblocked, it feeds his yellow meter and heals him.",
    "Be 3+ tiles from his 3x3 when he explodes (28-30).",
    "At 66% and 25% he teleports to the middle: block the diagonal cracks from the marked squares, dodge the blasts. A full meter makes the strike lethal.",
  ],
  2: [
    "Attack The Blade. Purple portals fire across their rows 4 ticks after lighting; stand where the two orange gaps cross (green tiles).",
    "The gaps aren't random: each round runs one of three set patterns (orange, red, green), and after the first they come in that order. Learn each pattern's first gap and you know the round; \"Phase 2 patterns\" numbers every wave's safe spot in its pattern's colour.",
    "When pools appear, step on the orange floor portal before all twelve fire.",
    "The skip (\"Phase 2 skip tiles\"): wait on the outer pink tile, 6 out diagonally, and click the inner one, 4 out, one tick before each volley. Running through the wave dodges it.",
  ],
  3: [
    "Pray Melee for his two swings, then step out of the shadow slash: 3 wide, straight or diagonal toward you.",
    "When he starts to spin, turn your overhead OFF (or be injured), then Protect from Melee for the saw blades.",
    "He does six attacks between specials. Every other special is the spin, all phase long; in between, Untether and Insolence take turns (Untether first in the first quadrant, Insolence first after). Spin rubble falls over you slowly: one step clears it.",
    "Void bombs drop where you stand and on the same tile of every quadrant, and stay. Stand at the edge when they come or they'll be under you in phase 4.",
    "The void vine holds you until it dies: cut it (solo, your attack switches to it when it roots you). Kill rifts within 30 ticks or they detonate on you. Untether: pray Magic, get under his 3x3 (purple) by the eruption, and step one tile out when it glows brightest. The slam hits anyone not under him; the aftershock a tick later hits anyone still under.",
    "After Obliteration, cross the stones (click a stone or the next quadrant) before the quadrant falls. Right-click a censer to light it.",
  ],
  4: [
    "Phase 4 is on the quadrant left standing. Phase 3's voids stay on it and still hurt.",
    "The inner void floods the 5x5 around him: wait outside it. The outer void floods the rest of the floor: step into the 5x5.",
    "Step off each explosion mark, pray against each transition attack, and kill void rifts before they burst.",
    "A Deflect overhead turns that style back on you: attack with another.",
  ],
};

function countedNames(items: readonly TierItem[]): string {
  const counts = new Map<string, number>();
  for (const { name } of items) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => (count === 1 ? name : `${name} ×${count}`)).join(", ");
}

function FullFightSidebar({ params, region, stage, clock, loadouts }: Readonly<{ params: Params; region: FightRegion; stage: Stage | null; clock: RunClock; loadouts: TierLoadouts }>) {
  const [draft, setDraft] = useState<Omit<Params, "tier">>(params);
  const set = (patch: Partial<Omit<Params, "tier">>) => setDraft((current) => ({ ...current, ...patch }));
  const { tier, active } = useTierLoadout(loadouts);
  const [editing, setEditing] = useState(false);
  const starts = tierStarts(active);
  const chosen = () => ({ ...draft, tier, weapon: tierStart(loadouts.active(), draft.weapon) });
  return (
    <Sidebar
      fight={
        <>
          <label>
            Start at
            <select id="start_phase" value={draft.startPhase} onChange={(event) => set({ startPhase: START_PHASES.find((phase) => String(phase) === event.target.value) ?? 1 })}>
              {START_PHASES.map((phase) => <option key={phase} value={phase}>{START_LABEL[phase]}</option>)}
            </select>
          </label>
          {loadouts.scope !== "raid" && (
            <label>
              Tier
              <select id="start_tier" value={tier} disabled={editing} onChange={(event) => loadouts.selectTier(parseTier(event.target.value))}>
                {TIERS.map((option) => <option key={option} value={option}>{OCELLUS_PRESETS[option].label}</option>)}
              </select>
              {OCELLUS_PRESETS[tier].notSimulated.length > 0 && <small id="tier_not_simulated">{`Not simulated yet, so left out: ${countedNames(OCELLUS_PRESETS[tier].notSimulated)}`}</small>}
            </label>
          )}
          <label>
            Start with
            <select id="start_weapon" value={tierStart(active, draft.weapon) ?? ""} onChange={(event) => set({ weapon: tierStart(active, event.target.value) })}>
              {starts.length === 0 ? <option value="">As worn</option> : starts.map(({ weapon, label }) => <option key={weapon} value={weapon}>{label}</option>)}
            </select>
          </label>
          {loadouts.scope === "editor" && <LoadoutSection loadouts={loadouts} clock={clock} onApply={() => writeParams(chosen(), false)} open={editing} setOpen={setEditing} />}
          <label>
            Defence drained
            <small>He starts each phase at his lowest Defence</small>
            <input id="defence_drained" type="checkbox" checked={draft.defenceDrained} onChange={(event) => set({ defenceDrained: event.target.checked })} />
          </label>
          <label>
            Solo vine
            <small>Attack your own vine</small>
            <input id="solo_vine" type="checkbox" checked={draft.soloVine} onChange={(event) => set({ soloVine: event.target.checked })} />
          </label>
          <label>
            Practice
            <small>Can't die, prayer stays up</small>
            <input
              id="practice"
              type="checkbox"
              checked={draft.invincible}
              onChange={(event) => {
                const on = event.target.checked;
                set({ invincible: on });
                region.setPractice(on);
                rememberFlag("practice", on);
              }}
            />
          </label>
          <RuneScapeButton id="start_fight" type="button" onClick={() => writeParams(chosen())}>Start fight</RuneScapeButton>
          {/* A reload, not an in-place reset: the SDK keeps clicks queued for the next world tick, and a reset would play them in the new run. */}
          <RuneScapeButton id="restart_fight" type="button" onClick={() => writeParams(chosen(), false)}>Restart</RuneScapeButton>
          {(stage === null || endingOf(stage) === null) && <RunPauseButton clock={clock} />}
        </>
      }
      aids={
        <>
          <label>
            Danger tiles
            <input
              id="hazard_tiles"
              type="checkbox"
              checked={draft.hazardTiles}
              onChange={(event) => {
                const on = event.target.checked;
                set({ hazardTiles: on });
                region.setHazardTiles(on);
                rememberFlag("tiles", on);
              }}
            />
          </label>
          <label>
            Prayer guide
            <small>Which prayer the next attack needs, when, and the tell that shows it</small>
            <input
              id="prayer_guide"
              type="checkbox"
              checked={draft.prayerGuide}
              onChange={(event) => {
                const on = event.target.checked;
                set({ prayerGuide: on });
                region.setPrayerGuide(on);
                rememberFlag("prayer", on);
              }}
            />
          </label>
          <label>
            Mechanics guide
            <small>Each attack in flight and on the floor, with its tick countdown and what to do</small>
            <input
              id="mechanics_guide"
              type="checkbox"
              checked={draft.mechanicsGuide}
              onChange={(event) => {
                const on = event.target.checked;
                set({ mechanicsGuide: on });
                region.setMechanicsGuide(on);
                rememberFlag("tells", on);
              }}
            />
          </label>
          <label>
            Community markers
            <input id="video_markers" type="checkbox" checked={draft.videoMarkers} onChange={(event) => set({ videoMarkers: event.target.checked })} />
          </label>
          <label>
            Phase 2 patterns
            <small>Number each wave's safe spot</small>
            <input
              id="pattern_markers"
              type="checkbox"
              checked={draft.patternMarkers}
              onChange={(event) => {
                const on = event.target.checked;
                set({ patternMarkers: on });
                region.setPatternMarkers(on);
                rememberFlag("pattern", on);
              }}
            />
          </label>
        </>
      }
      tips={<PhaseTips params={params} stage={stage} region={region} />}
    />
  );
}

function tipsPhase(stage: Stage | null, start: StartPhase): StartPhase {
  switch (stage?.phase) {
    case undefined:
      return start;
    case "p1":
      return 1;
    case "p2":
      return 2;
    case "p3":
      return 3;
    case "p4":
      return 4;
    default: {
      const unhandled: never = stage;
      return unhandled;
    }
  }
}

function PhaseTips({ params, stage }: Readonly<{ params: Params; stage: Stage | null; region: FightRegion }>) {
  const phaseNow = tipsPhase(stage, params.startPhase);
  return (
    <div id="phase_tips">
      <div className="sidebar_title">{`Phase ${phaseNow}`}</div>
      <ul>{TIPS[phaseNow].map((tip) => <li key={tip}>{tip}</li>)}</ul>
    </div>
  );
}

type FullFightSnapshot = Readonly<{
  tick: number;
  phase: string;
  url: string;
  getReady: number;
  p4: Readonly<{ run: RunState; boss: Readonly<{ hp: number; maxHp: number; defence: number; visible: boolean; at: Readonly<{ x: number; y: number }> }>; events: readonly string[] }> | null;
  outcome: "running" | "won" | "lost";
  player: ATile | null;
  hp: number;
  boss: Readonly<{ tile: ATile; hp: number; hidden: boolean }> | null;
  fallen: readonly Quadrant[];
  crumbling: readonly Quadrant[];
  stones: readonly ATile[];
  chat: readonly string[];
}>;

type Drawn = Readonly<{ tickPercent: number; boss: Location3 | null; player: Location3 | null }>;

/** His body through phase 3, with the pool its HP is a share of. P4's boss has its own block in the snapshot. */
function bossOf(stage: Stage | null): Readonly<{ unit: BossForm; pool: number }> | null {
  switch (stage?.phase) {
    case undefined:
    case "p4":
      return null;
    case "p1":
      return { unit: stage.p1.boss, pool: stage.p1.boss.stats.hitpoint };
    case "p2":
      return { unit: stage.p2.boss, pool: stage.p2.boss.stats.hitpoint };
    case "p3":
      return { unit: stage.p3.boss, pool: stage.p3.boss.stats.hitpoint };
    default: {
      const unhandled: never = stage;
      return unhandled;
    }
  }
}

function outcomeOf(stage: Stage | null): "running" | "won" | "lost" {
  const ending = stage && endingOf(stage);
  return ending === null ? "running" : ending.won ? "won" : "lost";
}

function exposeProbe(trainer: TrainerInstance, region: FightRegion): void {
  const player = () => {
    const first = region.players[0];
    return first instanceof FightPlayer ? first : null;
  };
  window.__fullFightProbe = Object.freeze({
    snapshot(): FullFightSnapshot {
      const stage = stageOf(region);
      const p4 = stage?.phase === "p4" ? stage.p4 : null;
      const boss = bossOf(stage)?.unit ?? null;
      const you = player();
      const floor = region.floorState();
      return {
        tick: stage ? stageTicks(stage) : 0,
        phase: stage ? stageLabel(stage) : "",
        url: window.location.href,
        getReady: trainer.getSnapshot().world.getReadyTimer,
        p4: p4 && {
          run: p4.ocellus.runState(),
          boss: { hp: p4.ocellus.currentStats.hitpoint, maxHp: p4.ocellus.stats.hitpoint, defence: p4.ocellus.currentStats.defence, visible: p4.ocellus.visible(), at: { ...p4.ocellus.location } },
          events: region.rows("p4").flatMap((row) => row.events.map((event) => `${event.at} ${event.kind}${"overhead" in event ? ` ${event.overhead}` : ""}`)),
        },
        outcome: outcomeOf(stage),
        player: you && you.arenaTile(),
        hp: you?.currentStats.hitpoint ?? 0,
        boss: boss && { tile: boss.tile, hp: boss.currentStats.hitpoint, hidden: boss.hidden },
        fallen: floor.destroyed,
        crumbling: floor.crumbling,
        stones: floor.stones,
        chat: region.chat().slice(-6).map((line) => line.text),
      };
    },
    tileCentre: (at) => Viewport.viewport.projectTile(toSdk(at), trainer.getSnapshot().world),
    die: () => {
      const stage = stageOf(region);
      if (stage?.phase === "p1") stage.p1.script.lose();
      if (stage?.phase === "p2") stage.p2.script.lose();
      if (stage?.phase === "p3") stage.p3.script.lose();
    },
    bossTo: (percent) => {
      const boss = bossOf(stageOf(region));
      if (boss) boss.unit.currentStats.hitpoint = Math.ceil((boss.pool * percent) / 100);
    },
    place: (at) => {
      const you = player();
      if (you) you.hop(at);
    },
    drawn: () => {
      const tickPercent = trainer.getSnapshot().world.tickPercent;
      const boss = region.primaryBoss;
      const you = player();
      return { tickPercent, boss: boss ? boss.getPerceivedLocation(tickPercent) : null, player: you ? you.getPerceivedLocation(tickPercent) : null };
    },
  });
}

export function FullFightPage() {
  const [{ trainer, region, params, clock, loadouts, started }] = useState(createTrainer);
  const [loading, setLoading] = useState<TrainerLoadingState>();
  const stage = useStage(region);
  const phase = stage?.phase;
  const ready = loading?.status === "ready";
  const download = useFirstDownload(params.startPhase, !ready);
  const ended = stage !== null && endingOf(stage) !== null;

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = FULL_FIGHT_CSS;
    document.head.append(style);
    if (process.env.NODE_ENV !== "production") {
      exposeProbe(trainer, region);
      exposeP4Probe(trainer, region, clock, region.p4Config, started);
    }
    return () => style.remove();
  }, [trainer, region, clock]);

  useEffect(() => {
    if (!ready) return;
    const anchor = region.entities[0];
    prefetchLaterPhases(params.startPhase);
    if (!anchor) return;
    return warmLaterPhases(anchor, params.startPhase);
  }, [ready, params.startPhase, region]);

  useLayoutEffect(() => {
    if (phase !== "p4") return;
    const facing = p4CameraFacing(region.floorState().destroyed);
    if (facing === null) return;
    aimPlatformCamera(facing);
  }, [phase, region]);

  return (
    <TrainerApp trainer={trainer} autoStart={false} onLoadingStateChange={setLoading}>
      <GameOverlay>
        <LoadingSplash state={loading} download={download} />
        {stage && stage.phase !== "p4" && <Hud stage={stage} region={region} />}
        <div className="guide-stack">
          <PrayerCard region={region} />
          <MechanicsCard region={region} />
        </div>
        <div id="hud_corner">
          <Chatbox stage={stage} region={region} />
        </div>
        {stage && <Result stage={stage} region={region} params={params} clock={clock} />}
        {!ended && <RunGate clock={clock} ready={ready} />}
      </GameOverlay>
      <FullFightSidebar params={params} region={region} stage={stage} clock={clock} loadouts={loadouts} />
    </TrainerApp>
  );
}
