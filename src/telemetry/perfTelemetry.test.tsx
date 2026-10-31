import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { Trainer } from "osrs-sdk";
import { FightRegion } from "../content/ocellus/full/region";
import { loadPage } from "../content/ocellus/tests/page";

const TICK_MS = 600;
const DEATH_RUN = "/?seed=1";
const TODAYS_DAILY_LOADS = 45_000;
const DAILY_SUMMARY_BUDGET = 20_000;

type Beacon = Readonly<{ url: string; summary: unknown }>;

class ConfigResponse extends Response {
  constructor(private readonly config: unknown) {
    super();
  }

  override json(): Promise<unknown> {
    return Promise.resolve(this.config);
  }
}

function network(sampleRate: number | null) {
  const beacons: Beacon[] = [];
  const offline = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (String(input).endsWith("/telemetry.json")) {
      return Promise.resolve(sampleRate === null ? new Response("", { status: 404 }) : new ConfigResponse({ sampleRate }));
    }
    return offline(input, init);
  });
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: (url: string, body: string) => beacons.push({ url, summary: JSON.parse(body) }) > 0,
  });
  return beacons;
}

async function play(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

function openRun(url: string) {
  const page = loadPage(url);
  const region = Trainer.player.region;
  if (!(region instanceof FightRegion)) throw new Error("the page built no full fight");
  const run = () => region.p4.mounted?.ocellus.runState();
  // Models never load offline, so the SDK's frame loop never starts; a fixed 600 ms ticker stands in for its tick cadence.
  const ticker = window.setInterval(() => region.world.tickWorld(), TICK_MS);
  const playUntil = async (done: () => boolean) => {
    for (let guard = 0; guard < 200 && !done(); guard++) await play(TICK_MS);
    if (!done()) throw new Error(`the run never got there: ${JSON.stringify({ run: run(), paused: region.world.isPaused, tick: region.world.globalTickCounter, now: performance.now(), raf: String(window.requestAnimationFrame).slice(0, 80) })}`);
  };
  const close = () => {
    window.clearInterval(ticker);
    page.close();
  };
  const runEnded = () => run()?.kind === "ended";
  const atTick = (t: number) => () => {
    const state = run();
    return state?.kind === "running" && state.tick >= t;
  };
  return { page, region, playUntil, runEnded, atTick, close };
}

function shippedSampleRate(): number {
  const config: unknown = JSON.parse(readFileSync(resolve(__dirname, "../telemetry.json"), "utf8"));
  if (typeof config !== "object" || config === null || !("sampleRate" in config) || typeof config.sampleRate !== "number") throw new Error("src/telemetry.json has no numeric sampleRate");
  return config.sampleRate;
}

function hidePage(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("Performance telemetry", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: 12 });
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    hidePage(false);
  });

  test("a sampled-in run that ends in death sends one summary of its frame and tick timings with no identifying field", async () => {
    const beacons = network(1);
    const { playUntil, runEnded, close } = openRun(DEATH_RUN);
    await playUntil(runEnded);
    await play(3 * TICK_MS);
    window.dispatchEvent(new Event("pagehide"));
    close();

    expect(beacons).toEqual([
      {
        url: "http://localhost/t",
        summary: {
          version: "2026.10.31",
          view: "3d",
          gpu: "unavailable",
          browser: "other",
          stage: "inner-void",
          end: "death",
          sampleRate: 1,
          runTicks: 23,
          frames: 862,
          frameMedianMs: 16,
          frameP95Ms: 16,
          frameP99Ms: 16,
          framesOver50Ms: 0,
          tickMedianMs: 605,
          tickP95Ms: 605,
          tickMaxMs: 608,
          lateTicks: 0,
          devicePixelRatio: 1,
          canvasWidth: 800,
          canvasHeight: 800,
          cores: 12,
        },
      },
    ]);
  });

  test.each([
    { name: "sampled in", sampleRate: 1, optedOut: false, untickAt: null, sent: ["death"] },
    { name: "sampled out at rate 0", sampleRate: 0, optedOut: false, untickAt: null, sent: [] },
    { name: "with the shipped telemetry.json and the luckiest draw", sampleRate: shippedSampleRate(), optedOut: false, untickAt: null, sent: ["death"], draw: 0 },
    { name: "with no readable telemetry.json", sampleRate: null, optedOut: false, untickAt: null, sent: [] },
    { name: "opted out before the page loaded", sampleRate: 1, optedOut: true, untickAt: null, sent: [] },
    { name: "opted out from Settings mid-run", sampleRate: 1, optedOut: false, untickAt: 20, sent: [] },
  ])("a run $name sends $sent.length summaries", async ({ sampleRate, optedOut, untickAt, sent, draw }) => {
    if (draw !== undefined) vi.spyOn(Math, "random").mockReturnValue(draw);
    if (optedOut) localStorage.setItem("archive-ocellus:perf-data", "off");
    const beacons = network(sampleRate);
    const { page, playUntil, runEnded, atTick, close } = openRun(DEATH_RUN);
    if (untickAt !== null) {
      await playUntil(atTick(untickAt));
      page.click("perf_data");
    }
    await playUntil(runEnded);
    await play(3 * TICK_MS);
    const box = { checked: page.checked("perf_data"), saved: localStorage.getItem("archive-ocellus:perf-data") };
    close();
    expect({ ends: beacons.map(({ summary }) => typeof summary === "object" && summary !== null && "end" in summary && summary.end), box }).toEqual({
      ends: sent,
      box: optedOut || untickAt !== null ? { checked: false, saved: "off" } : { checked: true, saved: null },
    });
  });

  test("a page load sends one summary however many of hide, run end and leave fire, so the shipped rate keeps 45,000 loads a day under 20,000 summaries", async () => {
    const beacons = network(1);
    const { playUntil, atTick, runEnded, close } = openRun(DEATH_RUN);
    await playUntil(atTick(20));
    hidePage(true);
    hidePage(false);
    await playUntil(runEnded);
    await play(3 * TICK_MS);
    hidePage(true);
    window.dispatchEvent(new Event("pagehide"));
    close();
    expect(beacons.map(({ summary }) => summary)).toEqual([
      expect.objectContaining({ end: "left", stage: "inner-void", runTicks: 18, frames: 712, lateTicks: 0 }),
    ]);
    expect(shippedSampleRate() * TODAYS_DAILY_LOADS * beacons.length).toBeLessThanOrEqual(DAILY_SUMMARY_BUDGET);
  });
});
