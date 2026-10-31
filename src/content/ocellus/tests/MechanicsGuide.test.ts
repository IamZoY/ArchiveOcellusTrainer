import { PROTECTION_PRAYER } from "../../../sim/prayerCue";
import { toRoom } from "../../../sim/frame";
import type { ATile } from "../fight/geometry";
import { bodyCentre, bodyCentreTile, fromSdk, lineBetween, quadrantTiles } from "../fight/geometry";
import { P3 } from "../full/data/p3";
import type { MechanicLabel, MechanicLine } from "../full/mechanicsGuide";
import { TONE_COLOUR } from "../full/mechanicsGuide";
import type { FightRegion } from "../full/region";
import { S, startP3 } from "./p3run";

/** What the mechanics guide showed after each tick's row closed. */
type Seen = Readonly<{ tick: number; lines: readonly MechanicLine[] | null; marks: readonly Readonly<{ tile: ATile; colour: number }>[]; labels: readonly MechanicLabel[] }>;

function look(region: FightRegion, tick: number): Seen {
  return { tick, lines: region.mechanicsCard(), marks: region.mechanicMarks().map(({ tile, colour }) => ({ tile, colour })), labels: region.mechanicLabels() };
}

/** The first tick the card listed a mechanic matching `what` that lands on `lands`, and whether its countdown was right. */
function warned(seen: readonly Seen[], lands: number, what: RegExp) {
  for (const { tick, lines } of seen) {
    if (tick >= lands || lines === null) continue;
    const line = lines.find((each) => what.test(each.what) && each.inTicks === lands - tick);
    if (line) return { shownAt: tick, line };
  }
  return null;
}

const key = (tile: ATile) => `${tile.x},${tile.z}`;
const marked = (seen: Seen | undefined, colour: number) => new Set(seen?.marks.filter((mark) => mark.colour === colour).map(({ tile }) => key(tile)));
const HARM = TONE_COLOUR.harm;

describe("the mechanics guide", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  function run(options: Parameters<typeof startP3>[0] = {}) {
    const f = startP3({ mechanicsGuide: true, ...options });
    close = f.close;
    const seen: Seen[] = [];
    const tickTo = (t: number, each: () => void = () => undefined) =>
      f.tickTo(t, () => {
        each();
        seen.push(look(f.region, f.now()));
      });
    const at = (t: number) => seen.find(({ tick }) => tick === t);
    return { ...f, seen, tickTo, at };
  }

  describe("phase 3's first quadrant", () => {
    function firstQuadrant() {
      const f = run();
      f.tickTo(S + 52, f.stayInReach);
      f.tickTo(S + 53 + 11);
      f.bossAt(75);
      f.tickTo(S + 90);
      f.stepOff();
      f.tickTo(S + 100);
      return f;
    }

    test("each void bomb: over you 3 ticks before its tiles fix, then every copy marked until it drops", () => {
      const f = firstQuadrant();
      const shown = f.looks("bomb-shown");
      expect(new Set(shown.map(([t]) => t)).size).toBeGreaterThan(0);
      for (const [t, bomb] of shown) {
        expect(warned(f.seen, t, /^Void bomb over you$/), `the overhead before ${t}`).toMatchObject({ shownAt: t - (P3.bombOverheadBefore - P3.bombDropAfter) });
        expect(warned(f.seen, bomb.drops, /^Void bomb drops/), `the bomb on ${key(bomb.tile)}`).toMatchObject({ shownAt: t, line: { inTicks: P3.bombDropAfter } });
        expect(marked(f.at(t), HARM).has(key(bomb.tile))).toBe(true);
      }
      // One bomb over you, copied onto the same tile of each other standing quadrant.
      expect(shown.filter(([t]) => t === shown[0][0]).length).toBeGreaterThan(1);
    });

    test("the shadow slash's band, spin rubble, and the saws' prayer are each listed and marked before they land", () => {
      const f = firstQuadrant();
      const bands = f.looks("band-landed").filter(([, look]) => look.role === "slash");
      expect(bands.length).toBeGreaterThan(1);
      for (const [t, band] of bands) {
        const shown = warned(f.seen, t, /^Shadow slash/);
        expect(shown, `the slash landing on ${t}`).not.toBeNull();
        const tiles = marked(f.at(shown?.shownAt ?? -1), HARM);
        expect(band.tiles.every((tile) => tiles.has(key(tile)))).toBe(true);
      }
      for (const [t, rubble] of f.looks("debris-shown")) {
        expect(warned(f.seen, rubble.falls, /^Spin rubble falls/)).toMatchObject({ shownAt: t });
        expect(marked(f.at(t), HARM).has(key(rubble.tile))).toBe(true);
      }
      const saw = warned(f.seen, S + 24 + P3.sawFirstCut, /saw blade \(melee\)/);
      expect(saw?.line.todo).toMatch(new RegExp(`^${PROTECTION_PRAYER.melee}\\. Overheads off`));
    });

    test("Untether's slam and aftershock, and the quadrant's fall, count down from the moves that set them", () => {
      const f = firstQuadrant();
      const [[U, zone]] = f.looks("zone");
      expect(warned(f.seen, zone.slams, /^Untether slam/)).toMatchObject({ shownAt: U, line: { todo: "Be under his 3x3 when it lands" } });
      expect(warned(f.seen, U + P3.untether.aftershock, /^Untether aftershock/)).toMatchObject({ shownAt: U });
      const [[fell, event]] = f.events().filter(([, each]) => each.kind === "quadrant-fell");
      const falls = warned(f.seen, fell, /quadrant falls$/);
      expect(falls?.line.todo).toBe("Cross the stones to a standing quadrant before it goes");
      expect(fell - (falls?.shownAt ?? fell)).toBe(P3.untether.gone - P3.untether.obliteration);
      if (event.kind !== "quadrant-fell") throw new Error("not a fall");
      const floor = marked(f.at(fell - 1), HARM);
      expect(quadrantTiles(event.quadrant).filter((tile) => floor.has(key(tile))).length).toBe(quadrantTiles(event.quadrant).length);
    });
  });

  test("Insolence's bands and the vine count down to the tick they land", () => {
    const f = run();
    f.tickTo(S + 210, f.stayInReach);
    const bands = f.looks("band-landed").filter(([, look]) => look.role === "superior-slash");
    expect(bands).toHaveLength(3);
    for (const [t] of bands) expect(warned(f.seen, t, /^Insolence slash/), `the band on ${t}`).toMatchObject({ shownAt: t - P3.insolenceLands });
    const roots = f.events().flatMap(([t, event]) => (event.kind === "vine-rooted" ? [t] : []));
    expect(roots).toEqual([S + 36, S + 191]);
    for (const t of roots) expect(warned(f.seen, t, /^Void vine roots you$/)).toMatchObject({ shownAt: t - P3.vineRootsAfter });
  });

  test("a panic shot's countdown rides from him to you and lights your tile", () => {
    const f = run();
    f.tickTo(S + 3, f.stayInReach);
    f.player().hop({ x: 8, z: 8 });
    f.tickTo(S + 4);
    const told = S + 4;
    expect(warned(f.seen, told + P3.panicLands, /^panic shot \(magic\)$/)).toMatchObject({ shownAt: told, line: { todo: PROTECTION_PRAYER.magic } });
    expect(marked(f.at(told), HARM).has("8,8")).toBe(true);
    const centre = bodyCentre({ sw: f.live().boss.tile, size: 3 });
    const at = (x: number, z: number) => f.region.mechanicLabels().some((label) => label.text === `${P3.panicLands}t` && Math.abs(label.x - x) < 1e-9 && Math.abs(label.z - z) < 1e-9);
    f.region.world.tickPercent = 0;
    expect(at(centre.x, centre.z)).toBe(true);
    f.region.world.tickPercent = 0.5;
    expect(at(centre.x + (8 - centre.x) / 4, centre.z + (8 - centre.z) / 4)).toBe(true);
  });

  describe("rifts in the second quadrant", () => {
    function secondQuadrant(seed: number) {
      const f = run({ seed });
      const P = S + 24;
      f.tickTo(P + 2, f.stayInReach);
      f.bossAt(75);
      f.stepOff();
      const S2 = P + 3 + P3.untether.nextSegment - P3.untether.obliteration;
      f.tickTo(S2 + 3 + P3.riftDetonatesAfter + 1);
      return f;
    }

    test("a rift left alive is marked on its tile, counting down to its burst", () => {
      const f = secondQuadrant(1);
      const [[t, burst]] = f.looks("rift-detonated");
      // Any kind bursts: which one a quadrant gets is seeded, and moves on with each quadrant.
      expect(warned(f.seen, t, /^Void (Rift|Augmenter|Siphon) bursts/)).toMatchObject({ shownAt: t - P3.riftDetonatesAfter });
      expect(marked(f.at(t - 1), HARM).has(key(burst.tile))).toBe(true);
    });

    test("a Void Siphon's heal flare is counted down at the siphon, with the line to stand on to block it lit", () => {
      const f = secondQuadrant(3);
      const flares = f.looks("projectile").filter(([, look]) => look.to === "boss");
      expect(flares.length).toBeGreaterThan(1);
      for (const [t, flare] of flares) {
        expect(warned(f.seen, t, /^Void Siphon heals Ocellus$/), `the flare on ${t}`).toMatchObject({ shownAt: t - P3.healRiftEvery });
        if (flare.from === "boss") throw new Error("a heal flare from the boss");
        const line = lineBetween(flare.from, bodyCentreTile({ sw: f.live().boss.tile, size: 3 }));
        const lit = marked(f.at(t - 1), TONE_COLOUR.heal);
        expect(line.length).toBeGreaterThan(0);
        expect(line.every((tile) => lit.has(key(tile)))).toBe(true);
      }
    });
  });

  test("phase 4 reads its schedule ahead: the shout, each steal, explosion and void blast counted down, explosions on their marked tile", () => {
    const f = startP3({ mechanicsGuide: true, startPhase: 4 });
    close = f.close;
    const { region } = f;
    const seen: Seen[] = [];
    const now = () => region.rows("p4").at(-1)?.tick ?? -1;
    for (let guard = 0; now() < 130; guard++) {
      if (guard > 200) throw new Error(`phase 4 stuck at ${now()}`);
      region.world.tickWorld();
      seen.push(look(region, now()));
    }
    const events = region.rows("p4").flatMap((row) => row.events.map((event) => [row.tick, event] as const));
    const frame = region.p4.mounted?.frame;
    if (!frame) throw new Error("phase 4 is not running");
    const shouts = events.flatMap(([t, e]) => (e.kind === "boss-shouted" ? [[t, e.text] as const] : []));
    expect(shouts.map(([, text]) => text)).toEqual(["End..."]);
    for (const [t, text] of shouts) expect(warned(seen, t, new RegExp(`^"${text}"$`)), `the shout on ${t}`).not.toBeNull();
    const steals = events.flatMap(([t, e]) => (e.kind === "lifeforce-drained" ? [t] : []));
    expect(steals.length).toBeGreaterThan(1);
    for (const t of steals) expect(warned(seen, t, /^Lifeforce steal$/), `the steal on ${t}`).not.toBeNull();
    const blasts = events.flatMap(([t, e]) => (e.kind === "special-hit" ? [[t, e.style] as const] : []));
    expect(blasts.length).toBeGreaterThan(1);
    for (const [t, style] of blasts) {
      const shown = warned(seen, t, new RegExp(`^Void blast \\(${style}\\)$`));
      expect(shown?.line.todo).toBe(PROTECTION_PRAYER[style]);
      expect(t - (shown?.shownAt ?? t)).toBe(5);
      // Before its tell it is listed without its style, which the game does not show sooner.
      expect(warned(seen, t, /^Void blast$/)?.line.todo).toBe("Its tell shows which prayer");
    }
    const marks = events.flatMap(([t, e]) => (e.kind === "explosion-marked" ? [{ t, e }] : []));
    const impacts = events.flatMap(([t, e]) => (e.kind === "explosion-resolved" ? [{ t, e }] : []));
    expect(impacts.length).toBeGreaterThan(3);
    for (const { t, e } of impacts) {
      const mark = marks.find((each) => each.e.void === e.void && each.e.pulse === e.pulse && each.t < t);
      if (!mark) throw new Error(`no mark before the impact on ${t}`);
      expect(warned(seen, t, new RegExp(`^Explosion ${e.pulse + 1}$`)), `the impact on ${t}`).not.toBeNull();
      const tile = fromSdk(toRoom(frame, mark.e.tile));
      expect(marked(seen.find(({ tick }) => tick === mark.t), HARM).has(key(tile)), `the tile marked on ${mark.t}`).toBe(true);
    }
  });

  test("off, it lists nothing and draws nothing; turned on mid-fight, it shows what is already coming", () => {
    const f = startP3({ mechanicsGuide: false });
    close = f.close;
    f.tickTo(S + 3, f.stayInReach);
    f.player().hop({ x: 8, z: 8 });
    f.tickTo(S + 4);
    expect({ card: f.region.mechanicsCard(), marks: f.region.mechanicMarks(), labels: f.region.mechanicLabels() }).toEqual({ card: null, marks: [], labels: [] });
    f.region.setMechanicsGuide(true);
    expect(f.region.mechanicsCard()?.map((line) => line.what)).toContain("panic shot (magic)");
    expect(f.region.mechanicMarks().length).toBeGreaterThan(0);
    expect(f.region.mechanicLabels().length).toBeGreaterThan(0);
    f.region.setMechanicsGuide(false);
    expect({ card: f.region.mechanicsCard(), marks: f.region.mechanicMarks(), labels: f.region.mechanicLabels() }).toEqual({ card: null, marks: [], labels: [] });
  });
});
