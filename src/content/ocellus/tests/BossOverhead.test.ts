import { ImageLoader, Settings, TrainerInstance, Viewport } from "osrs-sdk";
import type { FullFightOptions } from "../full/prefix";
import { FightRegion } from "../full/prefix";
import { paintedImages } from "../../../../test/paintedTiles";

describe("his overhead prayer", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
    vi.restoreAllMocks();
  });

  test("Untether's Protect from Melee draws the cache head icon under his HP bar once it loads, and nothing while it cannot", () => {
    // jsdom loads no images: this one stands in for the browser's, first failed, then loaded.
    const icon = document.createElement("img");
    let loadedWidth = 0;
    Object.defineProperty(icon, "complete", { get: () => true });
    Object.defineProperty(icon, "naturalWidth", { get: () => loadedWidth });
    const requested: string[] = [];
    const create = ImageLoader.createImage.bind(ImageLoader);
    vi.spyOn(ImageLoader, "createImage").mockImplementation((src: string) => {
      if (!String(src).startsWith("osrs-assets/")) return create(src);
      requested.push(src);
      return icon;
    });

    Settings.readFromStorage();
    const options: FullFightOptions = {
      seed: 1, party: 1, startPhase: 3, hazardTiles: false, videoMarkers: false, prayerGuide: false, mechanicsGuide: false, skipMarkers: false, patternMarkers: false, soloVine: true, invincible: true, defenceDrained: false,
    };
    const region = new FightRegion(options, () => undefined);
    const trainer = new TrainerInstance(region, { force2d: true });
    trainer.mount(document.createElement("canvas"), document.createElement("div"));
    close = () => trainer.dispose();
    region.world.getReadyTimer = 0;
    Viewport.viewport.resize(800, 600);
    const p3 = region.p3.mounted;
    if (!p3) throw new Error("the region did not start phase 3");
    const { boss } = p3;
    while (boss.overhead !== "protect-melee" && p3.now() < 200) region.world.tickWorld();

    const failed = paintedImages((context) => boss.drawOverheadPrayers(context, 30));
    loadedWidth = 30;
    const loaded = paintedImages((context) => boss.drawOverheadPrayers(context, 30));
    expect(failed).toEqual([]);
    // Sprite 440 (headicons_prayer) frame 0, 7 px under his HP bar as phase 4 draws its curses.
    expect(requested).toEqual(["osrs-assets/sprites/440-0.png"]);
    expect(loaded).toEqual([[icon, -15, 7, 30, 30]]);
  });
});
