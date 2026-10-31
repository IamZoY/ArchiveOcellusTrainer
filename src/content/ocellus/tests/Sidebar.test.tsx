import { ControlPanelController, Settings } from "osrs-sdk";
import { loadPage } from "./page";

const SAVED_SETTINGS = "osrs-sdk:settings";
const TILE_INDICATORS = ["destination_tile", "true_tile", "hovered_tile", "entity_outlines"] as const;

function savedTileIndicators() {
  const values = JSON.parse(localStorage.getItem(SAVED_SETTINGS) ?? "{}").values ?? {};
  return [values.targetTileEnabled, values.trueTileEnabled, values.hoveredTileEnabled, values.entityIndicatorEnabled];
}

function sidebarLayout() {
  const panel = document.querySelector("#right_panel");
  if (!panel) throw new Error("the page has no #right_panel");
  const scrolls = (element: Element) => {
    const style = getComputedStyle(element);
    return [style.overflowX, style.overflowY].some((overflow) => overflow === "auto" || overflow === "scroll");
  };
  const game = document.querySelector("#world")?.parentElement ?? null;
  const trainer = game?.parentElement ?? null;
  const policy = document.querySelector("#credit_line");
  return {
    scrollContainers: [panel, ...panel.querySelectorAll("*")].filter(scrolls).map((element) => element.id),
    panelOverflowX: getComputedStyle(panel).overflowX,
    sections: [...panel.querySelectorAll("#sidebar > section > .sidebar_title")].map((title) => title.textContent),
    tipsIn: document.getElementById("phase_tips")?.closest("section")?.id ?? null,
    policy: {
      text: policy?.textContent ?? null,
      overGame: game === null || game.contains(policy),
      trainerLayout: trainer ? getComputedStyle(trainer).display : null,
      trainerRows: trainer ? getComputedStyle(trainer).gridTemplateRows : null,
      stripRow: policy?.parentElement ? getComputedStyle(policy.parentElement).gridColumn : null,
      stripIsLastTrainerItem: trainer?.lastElementChild?.contains(policy) ?? false,
    },
  };
}

const POLICY_BELOW_GAME = {
  text: "Created using intellectual property belonging to Jagex Limited under the terms of Jagex's Fan Content Policy. This content is not endorsed by or affiliated with Jagex.",
  overGame: false,
  trainerLayout: "grid",
  trainerRows: "minmax(0, 1fr) auto",
  stripRow: "1 / -1",
  stripIsLastTrainerItem: true,
};

const openTab = () => Object.entries(ControlPanelController.controls).find(([, control]) => control === ControlPanelController.controller.selectedControl)?.[0] ?? null;

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe("the sidebar", () => {
  beforeEach(() => localStorage.removeItem(SAVED_SETTINGS));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Settings._isMobileResult = null;
    document.documentElement.classList.remove("phone-overlay");
  });

  test("the site's one panel has no drill or full fight toggle", () => {
    const page = loadPage("/");
    const toggles = ["full_fight", "phase_4_drill", "settings", "drill_controls"].filter((id) => document.getElementById(id) !== null);
    page.close();
    expect(toggles).toEqual([]);
  });

  test("each tile indicator box flips its SDK setting at once and saves it", () => {
    const page = loadPage("/?seed=1");
    const boxes = () => TILE_INDICATORS.map((id) => page.checked(id));
    const onLoad = boxes();
    for (const id of TILE_INDICATORS) page.click(id);
    const afterClick = { boxes: boxes(), saved: savedTileIndicators() };
    for (const id of TILE_INDICATORS) page.click(id);
    const afterSecondClick = { boxes: boxes(), saved: savedTileIndicators() };
    page.close();

    expect({ onLoad, afterClick, afterSecondClick }).toEqual({
      onLoad: [true, false, true, true],
      afterClick: { boxes: [false, true, false, false], saved: [false, true, false, false] },
      afterSecondClick: { boxes: [true, false, true, true], saved: [true, false, true, true] },
    });
  });

  test("Keybinds in the sidebar opens the key bindings", () => {
    const page = loadPage("/?seed=1&setup=ranged");
    page.click("keybinds");
    const tab = openTab();
    page.close();

    expect(tab).toEqual("SETTINGS");
  });

  test("on a phone, Keybinds closes the menu and opens the key bindings", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(PHONE);
    Settings._isMobileResult = null;
    const page = loadPage("/?seed=1");
    try {
      const panel = document.querySelector("#right_panel");
      if (!(panel instanceof HTMLElement)) throw new Error("the page has no #right_panel");
      page.click("phone_menu");
      page.click("keybinds");
      const menu = page.element("phone_menu");
      expect({
        menu: menu.textContent,
        expanded: menu.getAttribute("aria-expanded"),
        panel: panel.style.display,
        tab: openTab(),
      }).toEqual({ menu: "Menu", expanded: "false", panel: "none", tab: "SETTINGS" });
    } finally {
      page.close();
    }
  });

  test("the sidebar credits the makers first, then Alessandro Rodi on X, and the footer keeps the Jagex credit line", () => {
    const page = loadPage("/?seed=1");
    const credits = page.element("sidebar_credits");
    const shown = {
      lines: [...credits.querySelectorAll("li")].map((line) => line.textContent),
      links: [...credits.querySelectorAll("a")].map((link) => [link.textContent, link.href, link.target, link.rel]),
      jagex: page.element("credit_line").textContent,
      inFooter: credits.closest("#policy_footer") !== null && credits.closest("#right_panel") === null,
    };
    page.close();

    expect(shown).toEqual({
      lines: ["Made by Julian Dasilva / Moarhots: GitHub · @ShadowJdas", "With help from Alessandro Rodi"],
      links: [
        ["GitHub", "https://github.com/Julian-Dasilva/ArchiveOcellusTrainer", "_blank", "noopener noreferrer"],
        ["@ShadowJdas", "https://x.com/ShadowJdas", "_blank", "noopener noreferrer"],
        ["Alessandro Rodi", "https://x.com/alrodi", "_blank", "noopener noreferrer"],
      ],
      jagex: "Created using intellectual property belonging to Jagex Limited under the terms of Jagex's Fan Content Policy. This content is not endorsed by or affiliated with Jagex.",
      inFooter: true,
    });
  });

  test("on a phone, Menu opens the sidebar over the game and Close puts it away", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(PHONE);
    Settings._isMobileResult = null;
    const previousHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.id === "policy_footer" ? 96 : 0;
      },
    });
    const page = loadPage("/?seed=1");
    try {
      const panel = document.querySelector("#right_panel");
      const menu = page.element("phone_menu");
      if (!(panel instanceof HTMLElement)) throw new Error("the page has no #right_panel");
      const closed = { menu: menu.textContent, expanded: menu.getAttribute("aria-expanded"), panel: panel.style.display, overlay: document.documentElement.classList.contains("phone-overlay"), aboveFooter: panel.style.bottom };
      page.click("phone_menu");
      const opened = { menu: page.element("phone_menu").textContent, expanded: page.element("phone_menu").getAttribute("aria-expanded"), panel: panel.style.display, startPhase: panel.contains(page.element("start_phase")) };
      page.click("phone_menu");
      const again = { menu: page.element("phone_menu").textContent, panel: panel.style.display };

      expect({ closed, opened, again }).toEqual({
        closed: { menu: "Menu", expanded: "false", panel: "none", overlay: true, aboveFooter: "96px" },
        opened: { menu: "Close", expanded: "true", panel: "flex", startPhase: true },
        again: { menu: "Menu", panel: "none" },
      });
    } finally {
      page.close();
      if (previousHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", previousHeight);
      else Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
    }
  });

  test("the side panel is the only scroll container, never scrolls sideways, lists Fight, Co-op, Learning aids, Display, Sound, Controls and About with the phase tips in Learning aids, and the policy line sits below the game canvas", () => {
    const page = loadPage("/");
    const layout = sidebarLayout();
    page.close();

    expect(layout).toEqual({ scrollContainers: ["right_panel"], panelOverflowX: "hidden", sections: ["Fight", "Co-op", "Learning aids", "Display", "Sound", "Controls", "About"], tipsIn: "learning_aids", policy: POLICY_BELOW_GAME });
  });
});
