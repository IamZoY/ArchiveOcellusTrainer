import { Sound, SoundCache, TileMarker, cacheSound } from "osrs-sdk";
import type { Entity, Region, Unit } from "osrs-sdk";
import type { SpotOptions, TileMark } from "../../../fight/effects";
import { GroundSpot, LabelledTiles, TileMarks } from "../../../fight/effects";
import type { ATile } from "../../../fight/geometry";
import { QUADRANT_SIGN, at, toSdk } from "../../../fight/geometry";
import type { PortalView } from "../../../fight/portals";
import { PortalCross } from "../../../fight/portals";
import { P2 } from "../../data/p2";
import { SPOT } from "../../data/looks";
import { T } from "../data";
import { patternTiles } from "../pattern";
import type { GroundEffect, MarkRole, P2Look, P2Row, PortalFace, Tone } from "../types";

/** His spot() holds: the safe portal's despawn plays for 3 ticks, the sword drop and its boom for 6. */
const FADE_TICKS = 3;
const DROP_TICKS = 6;
const TONE: Readonly<Record<Tone, string>> = { game: "#000000", purple: "#7f00ff" };
const MARK: Readonly<Record<MarkRole, Readonly<{ colour: number; opacity: number; inset: number }>>> = {
  wave: { colour: 0x9b3cff, opacity: 0.18, inset: 0.05 },
  cross: { colour: 0x9b3cff, opacity: 0.32, inset: 0.05 },
  lane: { colour: 0x2bff73, opacity: 0.3, inset: 0.08 },
  pool: { colour: 0xd02020, opacity: 0.25, inset: 0.12 },
  escape: { colour: 0xffa020, opacity: 0.55, inset: 0.02 },
};

export type ChatLine = Readonly<{ text: string; colour: string; tick: number }>;

type Actors = Readonly<{ player: Unit }>;

function held(effect: GroundEffect): SpotOptions {
  switch (effect) {
    case "repair":
      return { maxTicks: T.repairEvery.value };
    case "pools":
      return { loopTicks: T.poolsLast.value, maxTicks: T.poolsLast.value };
    case "safe-spawn":
      return { maxTicks: T.oneTick.value + T.oneTick.value };
    case "safe-idle": {
      const open = T.safePortalUntil.value - T.safePortalAt.value;
      return { loopTicks: open - T.oneTick.value, maxTicks: open };
    }
    case "safe-despawn":
      return { maxTicks: FADE_TICKS };
    case "sword-drop":
    case "sword-explosion":
      return { maxTicks: DROP_TICKS };
    default: {
      const unhandled: never = effect;
      return unhandled;
    }
  }
}

function spotId(effect: GroundEffect): number {
  switch (effect) {
    case "repair":
      return SPOT.swordRepair;
    case "pools":
      return SPOT.p2Pool;
    case "safe-spawn":
      return SPOT.safePortalSpawn;
    case "safe-idle":
      return SPOT.safePortalIdle;
    case "safe-despawn":
      return SPOT.safePortalDespawn;
    case "sword-drop":
      return SPOT.swordDrop;
    case "sword-explosion":
      return SPOT.swordDropExplosion;
    default: {
      const unhandled: never = effect;
      return unhandled;
    }
  }
}

/**
 * Phase 2's looks, drawn from each closed row as phase 4's present() does. Hazard tiles and the skip and pattern markers
 * read the sidebar live, so a toggle during the fight shows on the next frame.
 */
export class P2Views {
  private faces: readonly PortalFace[] = [];
  private marks: readonly Readonly<{ tile: ATile; role: MarkRole }>[] = [];
  private cross: PortalCross | null = null;
  private skip: Entity[] = [];
  private pattern: Entity | null = null;
  private readonly owned: Entity[] = [];

  constructor(
    private readonly region: Region,
    private readonly actors: Actors,
    private readonly hazardTiles: () => boolean,
    private readonly skipMarkers: () => boolean,
    private readonly patternMarkers: () => boolean,
    private readonly say: (line: ChatLine) => void,
  ) {
    this.own(new TileMarks(region, () => this.floorMarks()));
    this.syncSkip();
    this.syncPattern();
  }

  present(row: P2Row): void {
    for (const event of row.events) if (event.kind === "shown") this.show(event.look, row.tick);
    this.syncSkip();
    this.syncPattern();
  }

  /** The sidebar's phase 2 skip tiles, on or off as the toggle stands. */
  syncSkip(): void {
    const show = this.skipMarkers();
    if (show === this.skip.length > 0) return;
    const gone = new Set<unknown>(this.skip);
    this.region.entities = this.region.entities.filter((entity) => !gone.has(entity));
    this.skip = [];
    if (!show) return;
    for (const { sx, sz } of Object.values(QUADRANT_SIGN)) {
      for (const out of [P2.skipStandOut, P2.skipRunOut]) {
        const marker = new TileMarker(this.region, toSdk(at(out * sx, out * sz)), P2.skipMarkerColour, 1, false);
        this.skip.push(marker);
        this.region.addEntity(marker);
      }
    }
  }

  /** The sidebar's phase 2 pattern tiles, on or off as the toggle stands. */
  syncPattern(): void {
    const show = this.patternMarkers();
    if (show === (this.pattern !== null)) return;
    const gone = this.pattern;
    this.region.entities = this.region.entities.filter((entity) => entity !== gone);
    this.pattern = show ? new LabelledTiles(this.region, patternTiles()) : null;
    if (this.pattern !== null) this.region.addEntity(this.pattern);
  }

  /** Every entity the views made, and the floor effects still playing, leave with the phase. */
  dispose(): void {
    const owned = new Set<unknown>([...this.owned, ...this.skip, this.pattern]);
    this.region.entities = this.region.entities.filter((entity) => !owned.has(entity) && !(entity instanceof GroundSpot));
    this.owned.splice(0, this.owned.length);
    this.skip = [];
    this.pattern = null;
  }

  private floorMarks(): readonly TileMark[] {
    if (!this.hazardTiles()) return [];
    return this.marks.map(({ tile, role }) => ({ tile, ...MARK[role] }));
  }

  private show(look: P2Look, now: number): void {
    switch (look.kind) {
      case "chat":
        this.say({ text: look.text, colour: TONE[look.tone], tick: now });
        return;
      case "portals":
        this.faces = look.faces;
        if (this.cross === null && look.faces.length > 0) {
          this.cross = new PortalCross(this.region, () => this.portalViews());
          this.own(this.cross);
        }
        return;
      case "marks":
        this.marks = look.tiles;
        return;
      case "ground":
        for (const tile of look.tiles) this.region.addEntity(new GroundSpot(this.region, tile, spotId(look.effect), held(look.effect)));
        return;
      case "player-spot":
        this.actors.player.addSpotAnim({ id: look.id, channel: look.channel });
        return;
      case "sound":
        SoundCache.play(new Sound(cacheSound(look.id), 0.6, 0, { location: toSdk(look.at), range: 31, retain: 31 }));
        return;
      default: {
        const unhandled: never = look;
        return unhandled;
      }
    }
  }

  private portalViews(): readonly PortalView[] {
    return this.faces.map((face) => ({ tiles: face.tiles, rotation: face.rotation, look: face.lit ? "lit" : "inactive" }));
  }

  private own(entity: Entity): void {
    this.region.addEntity(entity);
    this.owned.push(entity);
  }
}
