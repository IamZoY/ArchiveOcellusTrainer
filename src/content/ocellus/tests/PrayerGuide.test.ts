import type { Style } from "../../../sim/combat";
import type { P1Row } from "../full/p1/types";
import type { P3Row } from "../full/p3/types";
import type { ATile, Body } from "../fight/geometry";
import { at, covers, fromSdk } from "../fight/geometry";
import type { FightRegion } from "../full/region";
import type { GuideCard } from "../full/prayerGuide";
import { STYLE_COLOUR } from "../full/prayerGuide";
import { startP1 } from "./p1run";
import { S, startP3 } from "./p3run";

/** What the guide showed after each tick's row closed: the card, and the tiles it lit. */
type Seen = Readonly<{ tick: number; card: GuideCard | null; lit: readonly Readonly<{ tile: ATile; colour: number }>[]; ring: readonly ATile[] }>;

/** The ring of tiles one step outside his body as it stands now. */
function bossRing(region: FightRegion): readonly ATile[] {
  const boss = region.p4.mounted?.ocellus ?? region.p3.mounted?.boss ?? region.p1.mounted?.boss;
  return boss ? ringAround({ sw: fromSdk(boss.location), size: boss.size }) : [];
}

function look(region: FightRegion, tick: number): Seen {
  return { tick, card: region.prayerCard(), lit: region.prayerHighlight().map(({ tile, colour }) => ({ tile, colour })), ring: bossRing(region) };
}

/** Every prayable hit that landed: its tick and the style its prayer blocks. */
function prayableHits(rows: readonly (P1Row | P3Row)[], kinds: readonly string[]) {
  return rows.flatMap((row) =>
    row.events.flatMap((event) => (event.kind === "hit-requested" && event.damage.kind === "by-prayer" && kinds.includes(event.cause.kind) ? [{ lands: row.tick, style: event.damage.style, cause: event.cause.kind }] : [])),
  );
}

/** The first card that named this hit, with the tick it was shown on. */
function firstWarning(seen: readonly Seen[], hit: Readonly<{ lands: number; style: Style }>) {
  for (const { tick, card } of seen) {
    if (card?.kind !== "coming" || tick >= hit.lands) continue;
    const line = [card.now, card.next].find((each) => each !== null && each.cue.lands === hit.lands && each.cue.style === hit.style);
    if (line) return { shownAt: tick, inTicks: line.inTicks, attack: line.cue.attack, tell: line.cue.tell };
  }
  return null;
}

function ringAround(body: Body): readonly ATile[] {
  const tiles: ATile[] = [];
  for (let x = body.sw.x - 1; x <= body.sw.x + body.size; x++) {
    for (let z = body.sw.z - 1; z <= body.sw.z + body.size; z++) if (!covers(body, at(x, z))) tiles.push(at(x, z));
  }
  return tiles;
}

const sortTiles = (tiles: readonly ATile[]) => [...tiles].sort((a, b) => a.x - b.x || a.z - b.z);

describe("the prayer guide", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  describe("phase 1", () => {
    function run(prayerGuide: boolean) {
      const f = startP1({ prayerGuide });
      close = f.close;
      const seen: Seen[] = [];
      const tickTo = (t: number) => {
        while (f.now() < t) {
          f.tickOnce();
          seen.push(look(f.region, f.now()));
        }
      };
      return { ...f, seen, tickTo };
    }

    test("names each volley's prayer from its orb's colour before it lands, and lights a ring round him in that colour", () => {
      const f = run(true);
      f.tickTo(60);
      const hits = prayableHits(f.rows(), ["volley"]);
      expect(hits.length).toBeGreaterThan(3);
      for (const hit of hits) {
        const warned = firstWarning(f.seen, hit);
        expect(warned, `the volley landing on ${hit.lands}`).not.toBeNull();
        expect(warned?.inTicks).toBe(hit.lands - (warned?.shownAt ?? 0));
        expect(warned?.tell).toBe(hit.style === "magic" ? "blue water orb (magic volley) thrown by Ocellus" : "orange fire orb (ranged volley) thrown by Ocellus");
      }
      // Seed 1 opens on water on tick 4, a far shot that lands 4 ticks later.
      const opening = f.seen.find(({ tick }) => tick === 4);
      expect(opening?.card).toMatchObject({ kind: "coming", now: { inTicks: 4, cue: { style: "magic", attack: "water volley" } } });
      expect(sortTiles(opening?.lit.map(({ tile }) => tile) ?? [])).toEqual(sortTiles(opening?.ring ?? []));
      expect(opening?.ring.length).toBe(16);
      expect(new Set(opening?.lit.map(({ colour }) => colour))).toEqual(new Set([STYLE_COLOUR.magic]));
    });

    test("off, it shows no card and lights nothing; turned on mid-flight, it shows the volley already in the air", () => {
      const f = run(false);
      f.tickTo(4);
      const off = f.seen.at(-1);
      f.region.setPrayerGuide(true);
      expect({ card: off?.card, lit: off?.lit }).toEqual({ card: null, lit: [] });
      expect(f.region.prayerCard()).toMatchObject({ kind: "coming", now: { inTicks: 4, cue: { style: "magic" } } });
      expect(f.region.prayerHighlight().length).toBeGreaterThan(0);
      f.region.setPrayerGuide(false);
      expect({ card: f.region.prayerCard(), lit: f.region.prayerHighlight() }).toEqual({ card: null, lit: [] });
    });
  });

  describe("phase 3", () => {
    function run(options: Parameters<typeof startP3>[0] = {}) {
      const f = startP3({ prayerGuide: true, ...options });
      close = f.close;
      const seen: Seen[] = [];
      const tickTo = (t: number, each: () => void = () => undefined) =>
        f.tickTo(t, () => {
          each();
          seen.push(look(f.region, f.now()));
        });
      return { ...f, seen, tickTo };
    }

    test("the spin's opening and each saw are Melee, named from his blade before they cut, with the sever warning on the saws", () => {
      const f = run();
      const P = S + 24;
      f.tickTo(P + 16, f.stayInReach);
      const hits = prayableHits(f.rows(), ["spin-opening", "saw"]);
      expect(hits.map(({ lands, cause }) => [lands - P, cause])).toEqual([[1, "spin-opening"], [5, "saw"]]);
      const warnings = hits.map((hit) => firstWarning(f.seen, hit));
      expect(warnings).toEqual([
        { shownAt: P, inTicks: 1, attack: "spin opening", tell: "Ocellus draws his blade in to spin (melee), hitting anyone in reach" },
        { shownAt: P + 3, inTicks: 2, attack: "last saw blade", tell: "last saw blade on Ocellus, as the spin ends (melee cut)" },
      ]);
      const saw = f.seen.find(({ tick }) => tick === P + 3);
      expect(saw?.card).toMatchObject({ kind: "coming", now: { cue: { style: "melee", caution: "Overheads off the tick before the cut, or he severs them; Melee on for the cut itself" } } });
      expect(new Set(saw?.lit.map(({ colour }) => colour))).toEqual(new Set([STYLE_COLOUR.melee]));
    });

    test("a panic shot is Magic, named from the shout and the shot, and lights the tile it flies to", () => {
      const f = run();
      f.tickTo(S + 3, f.stayInReach);
      f.player().hop(at(8, 8));
      f.tickTo(S + 10);
      const [panic] = prayableHits(f.rows(), ["panic"]);
      expect(firstWarning(f.seen, panic)).toEqual({ shownAt: S + 4, inTicks: 2, attack: "panic shot", tell: "his purple magic cast, no shout: a magic shot flying at you" });
      expect(f.seen.find(({ tick }) => tick === S + 4)?.lit).toEqual([{ tile: at(8, 8), colour: STYLE_COLOUR.magic }]);
    });

    test("every Untether magic shot is Magic and named before it lands", () => {
      const f = run();
      const U = S + 53;
      f.tickTo(U + 40, f.stayInReach);
      const hits = prayableHits(f.rows(), ["untether-magic"]);
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) expect(firstWarning(f.seen, hit), `the shot landing on ${hit.lands}`).toMatchObject({ attack: "Untether magic", inTicks: 2 });
    });
  });

  test("phase 2 says it has no prayable attacks", () => {
    const f = startP3({ prayerGuide: true, startPhase: 2 });
    close = f.close;
    for (let i = 0; i < 20; i++) f.tickOnce();
    expect(f.region.current).toBe("p2");
    expect(f.region.prayerCard()).toEqual({ kind: "idle", note: "Phase 2 has no prayable attacks." });
    expect(f.region.prayerHighlight()).toEqual([]);
  });

  test("phase 4 names each transition attack's prayer from its tell, 5 ticks before it hits, with a ring round him", () => {
    const f = startP3({ prayerGuide: true, startPhase: 4 });
    close = f.close;
    const { region } = f;
    const seen: Seen[] = [];
    const now = () => region.rows("p4").at(-1)?.tick ?? -1;
    for (let guard = 0; now() < 130; guard++) {
      if (guard > 200) throw new Error(`phase 4 stuck at ${now()}`);
      region.world.tickWorld();
      seen.push(look(region, now()));
    }
    const hits = region.rows("p4").flatMap((row) => row.events.flatMap((event) => (event.kind === "special-hit" ? [{ lands: row.tick, style: event.style, variant: event.variant }] : [])));
    expect(hits.length).toBeGreaterThan(1);
    const TELL = {
      "black-disk": "purple semicircle, then a black disk over his footprint (melee transition attack)",
      "spike-disk": "dark disk with purple spikes reaching toward you (ranged transition attack)",
      vortex: "purple starburst, then a purple-rimmed ring around him (magic transition attack)",
    } as const;
    for (const hit of hits) expect(firstWarning(seen, hit), `the ${hit.variant} on ${hit.lands}`).toMatchObject({ inTicks: 5, tell: TELL[hit.variant] });
    const [first] = hits;
    const told = seen.find(({ tick }) => tick === first.lands - 5);
    expect(sortTiles(told?.lit.map(({ tile }) => tile) ?? [])).toEqual(sortTiles(told?.ring ?? []));
    expect(told?.ring.length).toBeGreaterThan(0);
    expect(new Set(told?.lit.map(({ colour }) => colour))).toEqual(new Set([STYLE_COLOUR[first.style]]));
  });
});
