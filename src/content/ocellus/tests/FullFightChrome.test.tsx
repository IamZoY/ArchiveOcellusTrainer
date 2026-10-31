import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ControlPanelController, Trainer, TrainerInstance, Viewport } from "osrs-sdk";
import type { TrainerLoadingState } from "osrs-sdk";
import { CHANGELOG } from "../changelog";
import { QUADRANTS, quadrantOf, quadrantTiles } from "../fight/geometry";
import { FightPlayer } from "../fight/units";
import { p4CameraFacing } from "../full/fall";
import { FightRegion } from "../full/prefix";
import { OCELLUS_P4 } from "../js/OcellusTimings";
import { FullFightPage } from "../full/page";

const POLICY = "Created using intellectual property belonging to Jagex Limited under the terms of Jagex's Fan Content Policy. This content is not endorsed by or affiliated with Jagex.";
const [LATEST_RELEASE] = CHANGELOG;

function loadFullFight(url: string) {
  window.history.replaceState(null, "", url);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<FullFightPage />));
  const element = (id: string): HTMLElement => {
    const found = container.querySelector<HTMLElement>(`#${id}`);
    if (!found) throw new Error(`the page has no #${id}`);
    return found;
  };
  return {
    element,
    checked: (id: string) => {
      const box = element(id);
      if (!(box instanceof HTMLInputElement)) throw new Error(`#${id} is not a checkbox`);
      return box.checked;
    },
    click: (id: string) => act(() => element(id).click()),
    press: (key: string) => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))),
    close: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Opens the page for `body` and closes it even when `body` throws, so a failure cannot leave a page for the next test. */
function withFullFight<T>(url: string, body: (page: ReturnType<typeof loadFullFight>) => T): T {
  const page = loadFullFight(url);
  try {
    return body(page);
  } finally {
    page.close();
  }
}

function captureAssign() {
  const real = window.location;
  const assigned: string[] = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get href() { return real.href; },
      get pathname() { return real.pathname; },
      assign: (url: string) => void assigned.push(url),
    },
  });
  return { assigned, restore: () => Object.defineProperty(window, "location", { configurable: true, value: real }) };
}

const openTab = () => Object.entries(ControlPanelController.controls).find(([, control]) => control === ControlPanelController.controller.selectedControl)?.[0] ?? null;

function phaseValue(element: HTMLElement): string | null {
  return element instanceof HTMLSelectElement ? element.value : null;
}

describe("the full fight page", () => {
  beforeEach(() => localStorage.removeItem("osrs-sdk:settings"));

  test("shows the chat and credits, our sidebar, and the fight controls, with no drill or full fight toggle", () => {
    const page = loadFullFight("/?mode=full&phase=1&seed=1");
    const corner = page.element("hud_corner");
    const credits = page.element("sidebar_credits");
    const shown = {
      corner: [...corner.children].map((child) => child.id),
      chat: corner.querySelector(".fight-chat"),
      hisMenu: document.querySelector(".fight-sidebar"),
      footer: [...page.element("policy_footer").children].map((child) => child.id),
      policy: page.element("credit_line").textContent,
      version: page.element("app_version").textContent,
      footerMaker: document.querySelector("#credits #maker_credit"),
      toggles: ["phase_4_drill", "full_fight"].filter((id) => document.getElementById(id) !== null),
      follow: document.body.textContent?.includes("Follow @alrodi on X") ?? false,
      lines: [...credits.querySelectorAll("li")].map((line) => line.textContent),
      links: [...credits.querySelectorAll("a")].map((link) => [link.textContent, link.href]),
      phase: phaseValue(page.element("start_phase")),
      aids: page.element("learning_aids").querySelector(".sidebar_title")?.textContent ?? null,
      danger: page.checked("hazard_tiles"),
      dangerInAids: page.element("learning_aids").contains(page.element("hazard_tiles")),
      markers: page.checked("video_markers"),
      practice: page.checked("practice"),
      tipsTitle: page.element("phase_tips").querySelector(".sidebar_title")?.textContent ?? null,
      firstTip: page.element("phase_tips").querySelector("li")?.textContent ?? null,
      keybinds: page.element("keybinds").textContent,
    };
    page.close();

    expect(shown).toEqual({
      corner: ["game_chat"],
      chat: null,
      hisMenu: null,
      footer: ["sidebar_credits", "credit_line", "app_version"],
      policy: POLICY,
      version: `v${LATEST_RELEASE.version}`,
      footerMaker: null,
      toggles: [],
      follow: false,
      lines: ["Made by Julian Dasilva / Moarhots: GitHub · @ShadowJdas", "With help from Alessandro Rodi"],
      links: [
        ["GitHub", "https://github.com/Julian-Dasilva/ArchiveOcellusTrainer"],
        ["@ShadowJdas", "https://x.com/ShadowJdas"],
        ["Alessandro Rodi", "https://x.com/alrodi"],
      ],
      phase: "1",
      aids: "Learning aids",
      danger: true,
      dangerInAids: true,
      markers: false,
      practice: false,
      tipsTitle: "Phase 1",
      firstTip: "Pray Missiles for the orange fire volleys, Magic for the blue water ones. Prayer is checked when the shot lands.",
      keybinds: "Keybinds",
    });
  });

  test("practice stays on without a reload, Keybinds opens the bindings, and Start fight reloads the chosen phase", () => {
    const page = loadFullFight("/?mode=full&phase=1&seed=1&weapon=blowpipe");
    page.click("practice");
    const practiced = { checked: page.checked("practice"), search: window.location.search };
    page.click("keybinds");
    const tab = openTab();
    const startPhase = page.element("start_phase");
    if (!(startPhase instanceof HTMLSelectElement)) throw new Error("start phase is not a select");
    act(() => {
      startPhase.value = "3";
      startPhase.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const navigation = captureAssign();
    page.click("start_fight");
    const assigned = navigation.assigned;
    navigation.restore();
    page.close();

    expect({ practiced, tab, assigned }).toEqual({
      practiced: { checked: true, search: "?mode=full&phase=1&seed=1&weapon=blowpipe&practice=1" },
      tab: "SETTINGS",
      assigned: [
        "http://localhost/?mode=full&phase=3&weapon=blowpipe&practice=1&tier=raid&drained=0&tiles=1&markers=0&prayer=0&tells=0&skip=0&pattern=0&vine=1",
      ],
    });
  });

  test.each(["/", "/?seed=1&invincible=on", "/?seed=4&bosshp=1&focus=void-floor&drillStart=cycle-start", "/?phase=p3&seed=1"])("%s opens the full fight with Start at on phase 4 and phase 4 mounted", (link) => {
    const page = loadFullFight(link);
    const select = page.element("start_phase");
    const shown = {
      startAt: select instanceof HTMLSelectElement ? select.value : null,
      tips: page.element("phase_tips").querySelector(".sidebar_title")?.textContent ?? null,
      phase: fightRegion().current,
    };
    page.close();
    expect(shown).toEqual({ startAt: "4", tips: "Phase 4", phase: "p4" });
  });

  test("Restart reloads the same seed with the toggles as they stand, so no click queued before it plays in the new run", () => {
    const page = loadFullFight("/?seed=7&weapon=melee");
    page.click("practice");
    const navigation = captureAssign();
    page.click("restart_fight");
    const assigned = navigation.assigned;
    navigation.restore();
    page.close();

    expect(assigned).toEqual(["http://localhost/?seed=7&weapon=melee&practice=1&phase=4&tier=raid&drained=0&tiles=1&markers=0&prayer=0&tells=0&skip=0&pattern=0&vine=1"]);
  });

  test("Start with is the twisted bow unless the link names another, and only the weapon in hand changes", () => {
    const dressed = (link: string) => {
      const page = loadFullFight(link);
      const you = fightRegion().players[0];
      const id = (item: { cacheItemId?: unknown } | null | undefined) => (typeof item?.cacheItemId === "number" ? item.cacheItemId : null);
      const shown = {
        chosen: document.getElementById("start_weapon") instanceof HTMLSelectElement ? phaseValue(page.element("start_weapon")) : null,
        weapon: id(you?.equipment.weapon),
        helmet: id(you?.equipment.helmet),
        bag: you?.inventory.map(id) ?? [],
      };
      page.close();
      return shown;
    };
    const supplies = [12695, 2444, 6685, 3024, 12695, 2444, 6685, 3024, 6685, 6685, 6685, 3024, 6685, 6685, 6685, 3024, 6685];
    expect({ unnamed: dressed("/?seed=1"), blowpipe: dressed("/?seed=1&weapon=blowpipe"), melee: dressed("/?seed=1&weapon=melee"), unknown: dressed("/?seed=1&weapon=bow") }).toEqual({
      unnamed: { chosen: "twistedBow", weapon: 20997, helmet: 27235, bag: [28922, 22325, 24419, 24420, 24421, 22981, 21295, 29801, 25485, ...supplies, 12926, 3024] },
      blowpipe: { chosen: "blowpipe", weapon: 12926, helmet: 27235, bag: [28922, 22325, 24419, 24420, 24421, 22981, 21295, 29801, 25485, ...supplies, 20997, 3024] },
      melee: { chosen: "melee", weapon: 22325, helmet: 24419, bag: [28922, 20997, 27235, 27238, 27241, 26235, 28951, 33639, 28310, ...supplies, 12926, 3024] },
      unknown: { chosen: "twistedBow", weapon: 20997, helmet: 27235, bag: [28922, 22325, 24419, 24420, 24421, 22981, 21295, 29801, 25485, ...supplies, 12926, 3024] },
    });
  });

  test("a tier link dresses that tier, Start with offers only its weapons, the panel names what it leaves out, and Restart keeps the tier chosen in the panel", () => {
    const choose = (id: string, value: string) =>
      act(() => {
        const select = document.getElementById(id);
        if (select instanceof HTMLSelectElement) {
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    const shown = () => {
      const you = fightRegion().players[0];
      const id = (item: { cacheItemId?: unknown } | null | undefined) => (typeof item?.cacheItemId === "number" ? item.cacheItemId : null);
      const weapons = document.getElementById("start_weapon");
      return {
        tier: phaseValue(document.getElementById("start_tier") ?? document.body),
        starts: weapons instanceof HTMLSelectElement ? [...weapons.options].map((option) => `${option.value} ${option.text}`) : [],
        chosen: weapons instanceof HTMLSelectElement ? weapons.value : null,
        leftOut: document.getElementById("tier_not_simulated")?.textContent ?? null,
        worn: [id(you?.equipment.weapon), id(you?.equipment.helmet), id(you?.equipment.gloves), id(you?.equipment.cape)],
      };
    };
    const low = loadFullFight("/?seed=1&tier=low&weapon=twistedBow");
    const lowShown = shown();
    low.close();
    const page = loadFullFight("/?seed=7&weapon=blowpipe");
    const raidShown = shown();
    choose("start_tier", "max");
    const maxPanel = shown();
    choose("start_weapon", "ralos");
    const navigation = captureAssign();
    page.click("restart_fight");
    const assigned = navigation.assigned;
    navigation.restore();
    page.close();

    expect({ lowShown, raidShown, maxStarts: maxPanel.starts, maxChosen: maxPanel.chosen, maxLeftOut: maxPanel.leftOut, assigned }).toEqual({
      lowShown: {
        tier: "low",
        starts: ["blowpipe Toxic blowpipe"],
        chosen: "blowpipe",
        leftOut:
          null,
        worn: [12926, 13199, 7462, 21295],
      },
      raidShown: { tier: "raid", starts: ["twistedBow Twisted bow (Masori)", "blowpipe Toxic blowpipe (Masori)", "melee Scythe (Inquisitor's)"], chosen: "blowpipe", leftOut: null, worn: [12926, 27235, 26235, 28951] },
      maxStarts: ["twistedBow Twisted bow (Masori)", "blowpipe Toxic blowpipe (Masori)", "ralos Tonalztics of Ralos (Inquisitor's)"],
      maxChosen: "blowpipe",
      maxLeftOut: null,
      assigned: ["http://localhost/?seed=7&weapon=ralos&phase=4&tier=max&drained=0&tiles=1&markers=0&prayer=0&tells=0&skip=0&pattern=0&vine=1&practice=0"],
    });
  });

  test("Defence drained starts phase 4 at his floor, and Restart keeps it with the start weapon chosen in the panel", () => {
    const opening = (link: string) => {
      const page = loadFullFight(link);
      const box = document.getElementById("defence_drained");
      const shown = { drained: box instanceof HTMLInputElement ? box.checked : null, defence: fightRegion().p4.mounted?.ocellus.currentStats.defence ?? null };
      page.close();
      return shown;
    };
    const full = opening("/?seed=7");
    const drained = opening("/?seed=7&drained=1");
    const page = loadFullFight("/?seed=7");
    act(() => {
      const weapon = document.getElementById("start_weapon");
      if (weapon instanceof HTMLSelectElement) {
        weapon.value = "melee";
        weapon.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.getElementById("defence_drained")?.click();
    });
    const navigation = captureAssign();
    page.click("restart_fight");
    const assigned = navigation.assigned;
    navigation.restore();
    page.close();

    expect({ full, drained, assigned }).toEqual({
      full: { drained: false, defence: 250 },
      drained: { drained: true, defence: 150 },
      assigned: ["http://localhost/?seed=7&phase=4&tier=raid&weapon=melee&drained=1&tiles=1&markers=0&prayer=0&tells=0&skip=0&pattern=0&vine=1&practice=0"],
    });
  });

  test("offers phase 4 on Start at, and choosing it reloads the full fight at phase 4", () => {
    const loaded = loadFullFight("/?mode=full&phase=4&weapon=blowpipe");
    const loadedSelect = loaded.element("start_phase");
    if (!(loadedSelect instanceof HTMLSelectElement)) throw new Error("start phase is not a select");
    const fromUrl = {
      offered: [...loadedSelect.options].map((option) => option.value),
      value: loadedSelect.value,
      title: loaded.element("phase_tips").querySelector(".sidebar_title")?.textContent ?? null,
    };
    loaded.close();

    const page = loadFullFight("/?mode=full&phase=1&weapon=blowpipe");
    const startPhase = page.element("start_phase");
    if (!(startPhase instanceof HTMLSelectElement)) throw new Error("start phase is not a select");
    act(() => {
      startPhase.value = "4";
      startPhase.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const navigation = captureAssign();
    page.click("start_fight");
    const assigned = navigation.assigned;
    navigation.restore();
    page.close();

    expect({ fromUrl, assigned }).toEqual({
      fromUrl: { offered: ["1", "2", "3", "4"], value: "4", title: "Phase 4" },
      assigned: ["http://localhost/?mode=full&phase=4&weapon=blowpipe&tier=raid&drained=0&tiles=1&markers=0&prayer=0&tells=0&skip=0&pattern=0&vine=1&practice=0"],
    });
  });

  test("danger tiles start on, the toggle hides them, and a reload keeps the choice", () => {
    const page = loadFullFight("/?mode=full&phase=1&seed=1");
    const region = fightRegion();
    const marks = () => {
      const views = region.p1.mounted?.views;
      if (!views) throw new Error("phase 1 is not running");
      return views.marks().length;
    };
    region.world.getReadyTimer = 0;
    let ticks = 0;
    for (; ticks < 80 && marks() === 0; ticks++) region.world.tickWorld();
    const shown = marks();
    page.click("hazard_tiles");
    const hidden = { marks: marks(), checked: page.checked("hazard_tiles"), search: window.location.search };
    page.click("hazard_tiles");
    const restored = { marks: marks(), checked: page.checked("hazard_tiles"), search: window.location.search };
    page.close();

    const saved = loadFullFight("/?mode=full&phase=1&seed=1&tiles=0");
    const savedRegion = fightRegion();
    const savedViews = savedRegion.p1.mounted?.views;
    if (!savedViews) throw new Error("phase 1 is not running");
    savedRegion.world.getReadyTimer = 0;
    for (let i = 0; i < ticks; i++) savedRegion.world.tickWorld();
    const off = { marks: savedViews.marks().length, checked: saved.checked("hazard_tiles") };
    saved.close();

    expect(shown).toBeGreaterThan(0);
    expect({ hidden, restored, off }).toEqual({
      hidden: { marks: 0, checked: false, search: "?mode=full&phase=1&seed=1&tiles=0" },
      restored: { marks: shown, checked: true, search: "?mode=full&phase=1&seed=1&tiles=1" },
      off: { marks: 0, checked: false },
    });
  });

  test("the prayer guide starts off, its toggle shows the card at once with the volley in the air, and a reload keeps the choice", () => {
    const card = () => document.getElementById("prayer_guide_card")?.textContent ?? null;
    const { before, on, off } = withFullFight("/?mode=full&phase=1&seed=1", (page) => {
      const region = fightRegion();
      region.world.getReadyTimer = 0;
      const told = () => region.rows("p1").some((row) => row.events.some((event) => event.kind === "prayer-told"));
      for (let ticks = 0; ticks < 40 && !told(); ticks++) region.world.tickWorld();
      const before = { checked: page.checked("prayer_guide"), inAids: page.element("learning_aids").contains(page.element("prayer_guide")), card: card() };
      page.click("prayer_guide");
      const on = { checked: page.checked("prayer_guide"), card: card(), search: window.location.search };
      page.click("prayer_guide");
      const off = { checked: page.checked("prayer_guide"), card: card(), search: window.location.search };
      return { before, on, off };
    });
    const kept = withFullFight("/?mode=full&phase=1&seed=1&prayer=1", (saved) => saved.checked("prayer_guide"));

    expect({ before, on, off, kept }).toEqual({
      before: { checked: false, inAids: true, card: null },
      on: { checked: true, card: "PROTECT MAGIClands in 4 ticksWhy: blue water orb (magic volley) thrown by Ocellus", search: "?mode=full&phase=1&seed=1&prayer=1" },
      off: { checked: false, card: null, search: "?mode=full&phase=1&seed=1&prayer=0" },
      kept: true,
    });
  });

  test("the mechanics guide starts off, its toggle lists what is coming at once, and a reload keeps the choice", () => {
    const card = () => document.getElementById("mechanics_guide_card")?.textContent ?? null;
    const { before, on, off } = withFullFight("/?mode=full&phase=1&seed=1", (page) => {
      const region = fightRegion();
      region.world.getReadyTimer = 0;
      const told = () => region.rows("p1").some((row) => row.events.some((event) => event.kind === "prayer-told"));
      for (let ticks = 0; ticks < 40 && !told(); ticks++) region.world.tickWorld();
      const before = { checked: page.checked("mechanics_guide"), inAids: page.element("learning_aids").contains(page.element("mechanics_guide")), card: card() };
      page.click("mechanics_guide");
      const on = { checked: page.checked("mechanics_guide"), card: card(), search: window.location.search };
      page.click("mechanics_guide");
      const off = { checked: page.checked("mechanics_guide"), card: card(), search: window.location.search };
      return { before, on, off };
    });
    const kept = withFullFight("/?mode=full&phase=1&seed=1&tells=1", (saved) => saved.checked("mechanics_guide"));

    expect({ before, on, off, kept }).toEqual({
      before: { checked: false, inAids: true, card: null },
      on: { checked: true, card: "4twater volley (magic)Protect from Magic", search: "?mode=full&phase=1&seed=1&tells=1" },
      off: { checked: false, card: null, search: "?mode=full&phase=1&seed=1&tells=0" },
      kept: true,
    });
  });

  test("the death dialog and the clear screen link both accounts, ours first", () => {
    const read = () => {
      const line = document.querySelector(".fight-result-follow");
      if (!(line instanceof HTMLParagraphElement)) throw new Error("the page has no update line");
      return {
        heading: document.querySelector(".fight-result h2")?.textContent ?? null,
        text: line.textContent,
        links: [...line.querySelectorAll("a")].map((link) => [link.textContent, link.href]),
      };
    };

    const dead = loadFullFight("/?mode=full&phase=1&seed=1");
    const lost = fightRegion().p1.mounted?.script;
    if (!lost) throw new Error("phase 1 is not running");
    act(() => lost.lose());
    const death = read();
    dead.close();

    const clear = loadFullFight("/?mode=full&phase=1&seed=1");
    const won = fightRegion().p1.mounted?.script;
    if (!won) throw new Error("phase 1 is not running");
    act(() => won.win());
    const victory = read();
    clear.close();

    const line = {
      text: "Updates and new sims: @ShadowJdas and @alrodi on X",
      links: [
        ["@ShadowJdas", "https://x.com/ShadowJdas"],
        ["@alrodi", "https://x.com/alrodi"],
      ],
    };
    expect({ death, victory }).toEqual({
      death: { heading: "Oh dear, you are dead!", ...line },
      victory: { heading: "Ocellus defeated", ...line },
    });
  });
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRAME_MS = 50;
const TICK_MS = 600;
const READY: TrainerLoadingState = { assetProgress: 1, assetsLoaded: 0, assetsReady: true, assetsTotal: 0, imagesReady: true, status: "ready", viewportReady: true };

let clock = 0;

function play(region: FightRegion, ms: number) {
  act(() => {
    for (let left = ms; left > 0; left -= FRAME_MS) region.world.browserLoop((clock += FRAME_MS));
  });
}

function gate() {
  const region = fightRegion();
  return {
    start: document.getElementById("start")?.textContent ?? null,
    pause: document.getElementById("pause")?.textContent ?? null,
    resume: document.getElementById("resume")?.textContent ?? null,
    world: region.world.globalTickCounter,
    held: region.world.isPaused,
    hud: document.querySelector(".fight-hud-tick")?.textContent ?? null,
    phase: region.current,
  };
}

/** Drops each pool to its floor and leaves a crumbling quadrant, so phase 3 reaches P4 without a death. */
function reachP4(region: FightRegion): void {
  const you = () => {
    const first = region.players[0];
    if (!(first instanceof FightPlayer)) throw new Error("the region has no full-fight player");
    return first;
  };
  const leave = () => {
    const crumbling = region.floorState().crumbling;
    const here = quadrantOf(you().arenaTile());
    if (crumbling[0] === undefined || here !== crumbling[0]) return;
    const next = QUADRANTS.find((quadrant) => quadrant !== here && !region.floorState().destroyed.includes(quadrant));
    if (!next) throw new Error("no quadrant left to stand on");
    const floor = quadrantTiles(next).find((tile) => region.p3.mounted?.arena.isWalkable(tile));
    if (!floor) throw new Error(`no floor in ${next}`);
    you().hop(floor);
  };
  act(() => {
    for (let step = 0; step < 2500 && region.floorState().destroyed.length < 3; step++) {
      region.world.tickWorld();
      const boss = region.p1.mounted?.boss;
      if (region.current === "p1" && boss && boss.form === "p1" && boss.currentStats.hitpoint > 0) boss.currentStats.hitpoint = 0;
      const p3 = region.p3.mounted;
      if (region.current === "p3" && p3) {
        p3.boss.currentStats.hitpoint = Math.min(p3.boss.currentStats.hitpoint, p3.script.hpFloor(p3.boss.stats.hitpoint));
        leave();
      }
    }
    for (let step = 0; step < 30 && region.current !== "p4"; step++) region.world.tickWorld();
  });
  if (region.current !== "p4") throw new Error(`the third fall left the fight in ${region.current}`);
}

describe("full fight pause", () => {
  beforeEach(() => {
    localStorage.clear();
    clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    vi.spyOn(TrainerInstance.prototype, "load").mockImplementation(async (options) => options?.onStateChange?.(READY));
    vi.spyOn(Viewport.prototype, "draw").mockReturnValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  test("phases 1, 2 and 3 wait on Start, and pause holds the tick until resume", async () => {
    const held: Record<number, ReturnType<typeof gate>> = {};
    for (const phase of [1, 2, 3] as const) {
      const page = loadFullFight(`/?mode=full&phase=${phase}&seed=1&practice=1`);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      held[phase] = gate();
      page.close();
    }

    expect(held).toEqual({
      1: { start: "Start", pause: null, resume: null, world: 0, held: true, hud: "tick 0", phase: "p1" },
      2: { start: "Start", pause: null, resume: null, world: 0, held: true, hud: "tick 0", phase: "p2" },
      3: { start: "Start", pause: null, resume: null, world: 0, held: true, hud: "tick 0", phase: "p3" },
    });

    const page = loadFullFight("/?mode=full&phase=1&seed=1&practice=1");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    play(fightRegion(), 10_000);
    const waiting = gate();
    page.click("start");
    play(fightRegion(), 8 * TICK_MS + FRAME_MS);
    const running = gate();
    page.click("pause");
    play(fightRegion(), 10_000);
    const paused = gate();
    page.click("resume");
    play(fightRegion(), TICK_MS + FRAME_MS);
    const resumed = gate();
    page.press("p");
    play(fightRegion(), 10_000);
    const pausedByKey = gate();
    page.press("p");
    play(fightRegion(), TICK_MS + FRAME_MS);
    const resumedByKey = gate();
    page.close();

    const shown = (row: ReturnType<typeof gate>) => ({ start: row.start, pause: row.pause, resume: row.resume, world: row.world, held: row.held, phase: row.phase });
    expect({
      waiting: shown(waiting),
      running: shown(running),
      paused: shown(paused),
      resumed: shown(resumed),
      pausedByKey: shown(pausedByKey),
      resumedByKey: shown(resumedByKey),
      hudWhilePaused: paused.hud,
      hudWhileKeyPaused: pausedByKey.hud,
    }).toEqual({
      waiting: { start: "Start", pause: null, resume: null, world: 0, held: true, phase: "p1" },
      running: { start: null, pause: "Pause (P)", resume: null, world: 8, held: false, phase: "p1" },
      paused: { start: null, pause: null, resume: "Resume (P)", world: 8, held: true, phase: "p1" },
      resumed: { start: null, pause: "Pause (P)", resume: null, world: 9, held: false, phase: "p1" },
      pausedByKey: { start: null, pause: null, resume: "Resume (P)", world: 9, held: true, phase: "p1" },
      resumedByKey: { start: null, pause: "Pause (P)", resume: null, world: 10, held: false, phase: "p1" },
      hudWhilePaused: running.hud,
      hudWhileKeyPaused: resumed.hud,
    });
  });

  test("Loadout pauses a live run and opens the editor, and Resume closes it", async () => {
    const page = loadFullFight("/?mode=full&phase=1&seed=1&practice=1");
    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      page.click("start");
      play(fightRegion(), 2 * TICK_MS + FRAME_MS);
      page.click("loadout");
      play(fightRegion(), 10_000);
      const opened = { ...gate(), editor: document.getElementById("loadout_editor") !== null };
      act(() => document.getElementById("resume")?.click());
      play(fightRegion(), TICK_MS + FRAME_MS);
      const resumed = { ...gate(), editor: document.getElementById("loadout_editor") !== null };

      expect({ opened: { resume: opened.resume, held: opened.held, world: opened.world, editor: opened.editor }, resumed: { held: resumed.held, world: resumed.world, editor: resumed.editor } }).toEqual({
        opened: { resume: "Resume (P)", held: true, world: 2, editor: true },
        resumed: { held: false, world: 3, editor: false },
      });
    } finally {
      page.close();
    }
  });

  test("pause after the third fall holds phase 4 on that tick", async () => {
    const page = loadFullFight("/?mode=full&phase=3&seed=1&practice=1");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const waiting = gate();
    expect(waiting).toEqual({ start: "Start", pause: null, resume: null, world: 0, held: true, hud: "tick 0", phase: "p3" });
    page.click("start");
    reachP4(fightRegion());
    const atP4 = gate();
    page.click("pause");
    play(fightRegion(), 10_000);
    const paused = gate();
    page.click("resume");
    play(fightRegion(), TICK_MS + FRAME_MS);
    const resumed = gate();
    page.close();

    expect({
      arrived: { pause: atP4.pause, held: atP4.held, phase: atP4.phase },
      paused: { resume: paused.resume, held: paused.held, world: paused.world, hud: paused.hud, phase: paused.phase },
      resumed: { world: resumed.world, phase: resumed.phase, held: resumed.held },
    }).toEqual({
      arrived: { pause: "Pause (P)", held: false, phase: "p4" },
      paused: { resume: "Resume (P)", held: true, world: atP4.world, hud: atP4.hud, phase: "p4" },
      resumed: { world: atP4.world + 1, phase: "p4", held: false },
    });
  });

  test("phase 4 hides the fight clock, shows the drill chat, and turns the camera with the platform", async () => {
    const faced: string[] = [];
    const page = loadFullFight("/?mode=full&phase=3&seed=1&practice=1");
    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const before = document.querySelector(".fight-hud") !== null;
      const region = fightRegion();
      page.click("start");
      const viewport = Viewport.viewport;
      vi.spyOn(viewport, "rotateSouth").mockImplementation(() => faced.push("south"));
      vi.spyOn(viewport, "rotateWest").mockImplementation(() => faced.push("west"));
      vi.spyOn(viewport, "rotateNorth").mockImplementation(() => faced.push("north"));
      vi.spyOn(viewport, "rotateEast").mockImplementation(() => faced.push("east"));
      reachP4(region);
      const lifeforce = OCELLUS_P4.lifeforce.tellChat.value;
      act(() => {
        for (let step = 0; step < 40 && !region.p4.mounted?.views.chat.includes(lifeforce); step++) region.world.tickWorld();
      });
      const lines = [...document.querySelectorAll("#game_chat li")];
      const shown = lines.map((line) => line.textContent);
      const drillLines = region.p4.mounted?.views.chat.slice(-5) ?? [];
      expect({
        clockBefore: before,
        clockDuring: document.querySelector(".fight-hud"),
        aimed: faced,
        historyKept: region.chat().some((line) => line.text.includes("Jump across the stones")),
        shown,
        lifeforceStyle: lines.find((line) => line.textContent === lifeforce)?.getAttribute("style") ?? null,
      }).toEqual({
        clockBefore: true,
        clockDuring: null,
        aimed: [p4CameraFacing(region.floorState().destroyed)],
        historyKept: true,
        shown: drillLines,
        lifeforceStyle: null,
      });
      expect(drillLines).toContain(lifeforce);
      expect(shown.some((text) => text?.includes("Jump across the stones"))).toBe(false);
    } finally {
      page.close();
    }
  });
});

function fightRegion(): FightRegion {
  const region = Trainer.player.region;
  if (!(region instanceof FightRegion)) throw new Error("the trainer is not the full fight");
  return region;
}

const LOADOUTS_KEY = "osrs-sdk:loadouts:archive-ocellus";
const MAX_WORN = { ammo: 33595, cape: 21295, chest: 24420, feet: 31097, gloves: 22981, helmet: 24419, legs: 24421, necklace: 29801, offhand: 25818, ring: 25485, weapon: 28922 };
const MAX_BAG = [26374, 26235, 28955, 27235, 33639, 27238, 27241, 25975, 12926, 20997, 2444, 2444, 34715, null, 23685, 12695, 34681, 34696, 3024, 3024, 6685, 6685, 3024, 3024, 6685, 6685, 10925, 27281];
const MAX_STARTS = ["Twisted bow (Masori)", "Toxic blowpipe (Masori)", "Tonalztics of Ralos (Inquisitor's)"];
const RAID_BAG = [28922, 22325, 24419, 24420, 24421, 22981, 21295, 29801, 25485, 12695, 2444, 6685, 3024, 12695, 2444, 6685, 3024, 6685, 6685, 6685, 3024, 6685, 6685, 6685, 3024, 6685, 12926, 3024];
const RAID_STARTS = ["Twisted bow (Masori)", "Toxic blowpipe (Masori)", "Scythe (Inquisitor's)"];
const withBag = (changes: Readonly<Record<number, number | null>>) => MAX_BAG.map((id, index) => (index in changes ? changes[index] : id));
const savedMax = (edit: unknown, version = 1) => JSON.stringify({ version, values: { selected: "max", edits: { max: edit } } });

describe("the loadout editor", () => {
  beforeEach(() => {
    localStorage.removeItem("osrs-sdk:settings");
    localStorage.removeItem(LOADOUTS_KEY);
    window.name = "";
  });

  const id = (item: { cacheItemId?: unknown } | null | undefined) => (typeof item?.cacheItemId === "number" ? item.cacheItemId : null);
  const dressedBag = () => fightRegion().players[0]?.inventory.map(id) ?? [];
  const editorText = () => [...document.querySelectorAll("#loadout_editor [role=status], #loadout_editor [role=alert]")].map((line) => line.textContent);
  const editorButton = (label: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("#loadout_editor button")].find((candidate) => candidate.textContent === label || candidate.getAttribute("aria-label") === label);
    if (!button) throw new Error(`the editor has no ${label} button`);
    act(() => button.click());
  };
  const presetOption = () => document.querySelector<HTMLSelectElement>("#loadout_editor select")?.selectedOptions[0]?.text ?? null;

  test("Apply saves the tier's edit and restarts on the same seed, and the reloaded run wears, carries and logs the edit", () => {
    const page = loadFullFight("/?seed=1&tier=max&weapon=ralos");
    page.click("loadout");
    const before = presetOption();
    editorButton("Take Saradomin Brew");
    const marked = presetOption();
    const navigation = captureAssign();
    editorButton("Apply");
    const assigned = navigation.assigned;
    navigation.restore();
    const stored: unknown = JSON.parse(localStorage.getItem(LOADOUTS_KEY) ?? "null");
    page.close();

    const reloaded = loadFullFight(assigned[0] ?? "/");
    const bag = dressedBag();
    const header = window.__archiveOcellusProbe?.log().header.loadout;
    reloaded.close();

    expect({ before, marked, assigned, stored, bag, header }).toEqual({
      before: "Max",
      marked: "Max (edited)",
      assigned: ["http://localhost/?seed=1&tier=max&weapon=ralos&phase=4&drained=0&tiles=1&markers=0&prayer=0&tells=0&skip=0&pattern=0&vine=1&practice=0"],
      stored: { version: 1, values: { selected: "max", edits: { max: { presetRevision: 3, loadout: { equipment: MAX_WORN, inventory: withBag({ 13: 6685 }) } } } } },
      bag: withBag({ 13: 6685 }),
      header: { preset: "max", edited: true, equipment: MAX_WORN, inventory: withBag({ 13: 6685 }) },
    });
  });

  test.each([
    {
      name: "guard: a build with ARCHIVE_LOADOUT=editor offers the tiers and Loadout, and starts on the saved edit",
      scope: "editor",
      edit: { equipment: MAX_WORN, inventory: withBag({ 13: 6685 }) },
      shown: { picker: true, button: true, note: null, starts: MAX_STARTS.slice(-1), start: "ralos", bag: withBag({ 13: 6685 }), preset: "max", edited: true },
    },
    {
      name: "a build with ARCHIVE_LOADOUT=tiers has no Loadout button and starts on the tier's preset",
      scope: "tiers",
      edit: { equipment: MAX_WORN, inventory: withBag({ 13: 6685 }) },
      shown: { picker: true, button: false, note: null, starts: MAX_STARTS, start: "ralos", bag: MAX_BAG, preset: "max", edited: false },
    },
    {
      name: "a build with ARCHIVE_LOADOUT=tiers shows no can't-load note for a saved edit that can't load",
      scope: "tiers",
      edit: { equipment: MAX_WORN, inventory: withBag({ 0: 99999 }) },
      shown: { picker: true, button: false, note: null, starts: MAX_STARTS, start: "ralos", bag: MAX_BAG, preset: "max", edited: false },
    },
    {
      name: "a build with ARCHIVE_LOADOUT=raid has no Tier picker, ignores tier= and the stored tier, and starts on the Raid twisted bow",
      scope: "raid",
      edit: { equipment: MAX_WORN, inventory: withBag({ 13: 6685 }) },
      shown: { picker: false, button: false, note: null, starts: RAID_STARTS, start: "twistedBow", bag: RAID_BAG, preset: "raid", edited: false },
    },
  ])("$name, keeping the saved edit stored", ({ scope, edit, shown }) => {
    const raw = savedMax({ presetRevision: 3, loadout: edit });
    localStorage.setItem(LOADOUTS_KEY, raw);
    vi.stubEnv("ARCHIVE_LOADOUT", scope);
    try {
      const page = loadFullFight("/?seed=1&tier=max&weapon=ralos");
      const startWith = page.element("start_weapon");
      if (!(startWith instanceof HTMLSelectElement)) throw new Error("Start with is not a select");
      const header = window.__archiveOcellusProbe?.log().header.loadout;
      const observed = {
        picker: document.getElementById("start_tier") !== null,
        button: document.getElementById("loadout") !== null,
        note: document.getElementById("loadout_note")?.textContent ?? null,
        starts: [...startWith.options].map((option) => option.text),
        start: startWith.value,
        bag: dressedBag(),
        preset: header?.preset,
        edited: header?.edited,
      };
      page.close();
      expect({ ...observed, kept: localStorage.getItem(LOADOUTS_KEY) === raw }).toEqual({ ...shown, kept: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test.each([
    { row: "an unknown id", edit: { equipment: MAX_WORN, inventory: withBag({ 0: 99999 }) }, reason: "Your Max edit uses 1 item this version doesn't have (inventory slot 1)" },
    { row: "a worn item in a slot it no longer fits", edit: { equipment: { ...MAX_WORN, helmet: 20997 }, inventory: MAX_BAG }, reason: "Your Max edit wears 1 item in a slot that no longer fits (helmet slot)" },
    { row: "a bag that is not 28 slots", edit: { equipment: MAX_WORN, inventory: MAX_BAG.slice(1) }, reason: "Your Max edit could not be read (inventory has 27 slots, expected 28)" },
    { row: "more supplies than the tier and the shop allow", edit: { equipment: MAX_WORN, inventory: withBag({ 0: 6685, 2: 6685, 7: 6685, 10: 6685, 11: 6685, 12: 6685, 13: 6685 }) }, reason: "Your Max edit carries more than the supplies allow (Saradomin Brew 11 of 10)" },
    { row: "more of a supply the shop does not stock than the tier carries", edit: { equipment: MAX_WORN, inventory: Array<number>(28).fill(12695) }, reason: "Your Max edit carries more than the supplies allow (Super combat potion(4) 28 of 1)" },
  ])("a saved edit with $row starts on the preset, names why with Reset, and stays stored until Reset", ({ edit, reason }) => {
    const raw = savedMax({ presetRevision: 3, loadout: edit });
    localStorage.setItem(LOADOUTS_KEY, raw);
    const page = loadFullFight("/?seed=1&tier=max&weapon=ralos");
    const bag = dressedBag();
    const note = document.getElementById("loadout_note")?.textContent ?? null;
    page.click("loadout");
    const reasons = editorText();
    const navigation = captureAssign();
    editorButton("Apply");
    navigation.restore();
    const keptThroughApply = localStorage.getItem(LOADOUTS_KEY) === raw;
    editorButton("Reset");
    const afterReset = { edits: JSON.parse(localStorage.getItem(LOADOUTS_KEY) ?? "null")?.values.edits, note: document.getElementById("loadout_note"), reasons: editorText() };
    page.close();

    expect({ bag, note, reasons, keptThroughApply, afterReset }).toEqual({
      bag: MAX_BAG,
      note: "Your Max edit can't load, so the run starts on the preset. Open Loadout to see why.",
      reasons: [reason],
      keptThroughApply: true,
      afterReset: { edits: {}, note: null, reasons: [] },
    });
  });

  test("an edit of an older tier revision still starts the run, says the tier changed, and Reset returns to the tier", () => {
    localStorage.setItem(LOADOUTS_KEY, savedMax({ presetRevision: 0, loadout: { equipment: MAX_WORN, inventory: withBag({ 13: 6685 }) } }));
    const page = loadFullFight("/?seed=1&tier=max&weapon=ralos");
    const bag = dressedBag();
    page.click("loadout");
    const notices = editorText();
    editorButton("Reset");
    const after = { edits: JSON.parse(localStorage.getItem(LOADOUTS_KEY) ?? "null")?.values.edits, notices: editorText(), option: presetOption() };
    page.close();

    expect({ bag, notices, after }).toEqual({
      bag: withBag({ 13: 6685 }),
      notices: ["This tier changed since you edited it"],
      after: { edits: {}, notices: [], option: "Max" },
    });
  });

  test.each([
    { row: "unparseable JSON", raw: '{"version":1,"values":{"selected":"max"', warned: true },
    { row: "a newer version", raw: JSON.stringify({ version: 2, values: { tiers: { max: { slots: [] } } } }), warned: false },
  ])("$row starts every tier on its preset and is never overwritten by loading or choosing a tier", ({ raw, warned }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    localStorage.setItem(LOADOUTS_KEY, raw);
    const page = loadFullFight("/?seed=1&tier=max&weapon=ralos");
    const bag = dressedBag();
    act(() => {
      const select = page.element("start_tier");
      if (!(select instanceof HTMLSelectElement)) throw new Error("the tier is not a select");
      select.value = "high";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    page.click("loadout");
    const shown = { option: presetOption(), notices: editorText(), note: document.getElementById("loadout_note") };
    const warnings = warn.mock.calls.some(([message]) => String(message).includes(LOADOUTS_KEY));
    page.close();
    warn.mockRestore();

    expect({ bag, shown, warnings, kept: localStorage.getItem(LOADOUTS_KEY) }).toEqual({
      bag: MAX_BAG,
      shown: { option: "High", notices: [], note: null },
      warnings: warned,
      kept: raw,
    });
  });

  test("storage the browser refuses still runs the tier, says edits won't be kept, and Apply's edit starts the next run in this tab", () => {
    const own = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    try {
      const page = loadFullFight("/?seed=1&tier=max&weapon=ralos");
      const bag = dressedBag();
      page.click("loadout");
      editorButton("Take Saradomin Brew");
      const notices = editorText();
      const navigation = captureAssign();
      editorButton("Apply");
      const assigned = navigation.assigned;
      navigation.restore();
      page.close();
      const restarted = loadFullFight(assigned[0] ?? "/");
      const header = window.__archiveOcellusProbe?.log().header.loadout;
      restarted.close();

      expect({ bag, notices, restarted: { edited: header?.edited, bag: header?.inventory } }).toEqual({
        bag: MAX_BAG,
        notices: ["This browser is not saving data, so edits won't be kept"],
        restarted: { edited: true, bag: withBag({ 13: 6685 }) },
      });
    } finally {
      if (own) Object.defineProperty(window, "localStorage", own);
      else Reflect.deleteProperty(window, "localStorage");
    }
  });

  test("the editor omits the unavailable-stock notice when every supply is stocked", () => {
    const page = loadFullFight("/?seed=1&tier=max&weapon=ralos");
    try {
      page.click("loadout");
      expect(document.getElementById("loadout_editor")).not.toBeNull();
      expect(document.getElementById("shop_not_simulated")).toBeNull();
      expect(page.element("loadout_editor").textContent).not.toContain("Not simulated yet, so not stocked:");
    } finally {
      page.close();
    }
  });

  test("an open editor keeps the Max draft across a trip to High and back", () => {
    const page = loadFullFight("/?seed=1&tier=max&weapon=ralos");
    page.click("loadout");
    editorButton("Take Saradomin Brew");
    const choose = (tier: string) =>
      act(() => {
        const select = document.querySelector<HTMLSelectElement>("#loadout_editor select");
        if (!select) throw new Error("the editor has no tier select");
        select.value = tier;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    const firstSlot = () => document.querySelector('#loadout_editor [aria-label="Inventory slot 14"] img')?.getAttribute("alt") ?? null;
    choose("high");
    const high = { option: presetOption(), first: firstSlot() };
    choose("max");
    const max = { option: presetOption(), first: firstSlot() };
    page.close();

    expect({ high, max }).toEqual({ high: { option: "High", first: null }, max: { option: "Max (edited)", first: "Saradomin Brew" } });
  });

  test("loading, opening the editor, an unchanged Apply, choosing a tier and an untouched Reset write nothing, and a save keeps the stored value's other fields", () => {
    const raw = JSON.stringify({ version: 1, values: { selected: "raid", edits: {}, note: "kept" }, extension: "kept" }, null, 2);
    localStorage.setItem(LOADOUTS_KEY, raw);
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const written = () => writes.mock.calls.filter(([key]) => key === LOADOUTS_KEY).length;
    const navigation = captureAssign();
    try {
      const page = loadFullFight("/?seed=1&tier=max&weapon=ralos");
      const steps: Record<string, number> = { loaded: written() };
      page.click("loadout");
      steps.opened = written();
      editorButton("Apply");
      steps.unchangedApply = written();
      act(() => {
        const select = document.querySelector<HTMLSelectElement>("#loadout_editor select");
        if (!select) throw new Error("the editor has no tier select");
        select.value = "high";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      steps.choseTier = written();
      editorButton("Reset");
      steps.untouchedReset = written();
      const untouched = localStorage.getItem(LOADOUTS_KEY);
      editorButton("Take Saradomin Brew");
      editorButton("Apply");
      const saved: unknown = JSON.parse(localStorage.getItem(LOADOUTS_KEY) ?? "null");
      page.close();

      expect({ steps, untouched, saved }).toEqual({
        steps: { loaded: 0, opened: 0, unchangedApply: 0, choseTier: 0, untouchedReset: 0 },
        untouched: raw,
        saved: {
          version: 1,
          values: { selected: "raid", note: "kept", edits: { high: { presetRevision: 3, loadout: expect.objectContaining({ inventory: expect.arrayContaining([6685]) }) } } },
          extension: "kept",
        },
      });
    } finally {
      navigation.restore();
      writes.mockRestore();
    }
  });

  test("Start with lists only the tier's starts the edit can make, and none means the run starts as worn", () => {
    const listed = (edit: unknown) => {
      localStorage.setItem(LOADOUTS_KEY, savedMax({ presetRevision: 3, loadout: edit }));
      const page = loadFullFight("/?seed=1&tier=max&weapon=twistedBow");
      const select = page.element("start_weapon");
      const shown = {
        starts: select instanceof HTMLSelectElement ? [...select.options].map((option) => option.text) : [],
        weapon: id(fightRegion().players[0]?.equipment.weapon),
      };
      page.close();
      return shown;
    };

    expect({
      noBows: listed({ equipment: MAX_WORN, inventory: withBag({ 8: null, 9: null }) }),
      nothingToStart: listed({ equipment: { ...MAX_WORN, weapon: null }, inventory: withBag({ 8: null, 9: null }) }),
    }).toEqual({
      noBows: { starts: ["Tonalztics of Ralos (Inquisitor's)"], weapon: 28922 },
      nothingToStart: { starts: ["As worn"], weapon: null },
    });
  });
});
