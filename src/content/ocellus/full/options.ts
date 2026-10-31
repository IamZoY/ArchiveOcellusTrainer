/** What a full-fight run is started with. Phase 4 opens where the third fall leaves the arena. */
export const START_PHASES = [1, 2, 3, 4] as const;
export type StartPhase = (typeof START_PHASES)[number];

export type FullFightOptions = Readonly<{
  seed: number;
  party: number;
  startPhase: StartPhase;
  hazardTiles: boolean;
  videoMarkers: boolean;
  /** The prayer guide: which protection prayer the next attack needs, when, and the tell that gives it away. */
  prayerGuide: boolean;
  /** The mechanics guide: each telegraphed mechanic on the floor and in flight, with its tick countdown and what to do. */
  mechanicsGuide: boolean;
  /** Mark the phase 2 skip tiles. */
  skipMarkers: boolean;
  /** Number each phase 2 wave's safe spot in its gap sequence's colour. */
  patternMarkers: boolean;
  soloVine: boolean;
  invincible: boolean;
  /** Each phase opens with his Defence at the floor the hotfix allows, as if every drain had landed. */
  defenceDrained: boolean;
}>;

export type ChatLine = Readonly<{ text: string; colour: string; tick: number }>;

export const CHAT = {
  game: "#000000",
  red: "#ef1020",
  purple: "#7f00ff",
  boss: "#a32ac9",
  green: "#0b6e0b",
  blue: "#0000ff",
} as const;

/** The HUD clock. A tick is 0.6 seconds. */
export function formatTicks(ticks: number): string {
  const seconds = ticks * 0.6;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}
