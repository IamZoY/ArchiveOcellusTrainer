import { loadPage } from "./page";

const SEEN_RELEASE_KEY = "archive-ocellus:seen-release";
const SHOWN_VERSIONS = ["2026.10.31", "2026.10.29", "2026.10.28", "2026.10.27", "2026.10.26.2"];
const COOP_NOTE =
  "You see each other walk, swing and pray as it happens, each in their own gear with their health above them. A friend's attack is their own weapon's, special included, and it lands on the boss you are all fighting, on the tick they landed it, so his bar, his phase changes and the kill come from the whole party's work. Everyone picks their own tier, shown beside their name. The boss is on one of you at a time, marked in the Co-op list, and only that person takes its hits. If you die you keep watching whoever is still standing, as in game.";

const NEXT_RELEASE = {
  version: "2026.10.29",
  date: "2026-10-29",
  notes: [
    "Tick Fixed mode under Display for the classic fixed interface: the 765 by 503 frame, scaled to fit the window, with its minimap, orbs, tabs and side panel where the fixed client puts them. Chat sits in the frame's chatbox in black text, and the camera turns and zooms only from the game view, as in game.",
    "Phase 2's portal gaps follow the game's three set patterns, orange, red and green, in the game's order after a random first, and Phase 2 patterns in Learning aids numbers every wave's safe spot, 1 to 6, in its pattern's colour.",
    "In phase 3, the Void Rift, Void Siphon and Void Augmenter now play their spawn, despawn and detonate animations, and killing a Void Siphon heals you 22.",
    "Your bag now carries ranging potions instead of Bastion potions, and potion boosts wear off over time as in game, 1 level a minute.",
    "In phase 3, a sever blocks your protection prayers for one tick, as in game, so Protect from Melee clicked straight back on is up for the next saw, and \"Your panic... is futile...\" now warns of a Void Vine, not his magic shot. In phase 1, he walks out of the middle a tick later after his strike.",
  ],
};

function whatsNew(page: ReturnType<typeof loadPage>) {
  const panel = page.element("whats_new_panel");
  return {
    menuDot: page.element("whats_new").querySelector(".unseen_dot") !== null,
    panelShown: panel.hidden === false,
    releases: [...panel.querySelectorAll("article")].map((article) => ({
      version: article.querySelector("h3")?.textContent,
      date: article.querySelector("time")?.getAttribute("datetime"),
      notes: [...article.querySelectorAll("li")].map((note) => note.textContent),
    })),
  };
}

describe("What's new", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("a first visit shows the dot until What's new is opened from About, the panel lists the releases newest first, and a reload keeps the dot cleared", () => {
    const page = loadPage("/");
    const firstVisit = { ...whatsNew(page), inAbout: page.element("sidebar_about").contains(page.element("whats_new")) };
    page.click("whats_new");
    const opened = { ...whatsNew(page), expanded: page.element("whats_new").getAttribute("aria-expanded") };
    page.click("whats_new_close");
    const closed = whatsNew(page).panelShown;
    const version = page.element("app_version").textContent;
    page.close();
    const reloaded = loadPage("/");
    const afterReload = whatsNew(reloaded);
    reloaded.close();
    const versions = opened.releases.map((release) => release.version ?? "");

    expect({ firstVisit, opened, closed, afterReload, version, newestFirst: versions.join() === [...versions].sort().reverse().join() }).toEqual({
      firstVisit: { menuDot: true, panelShown: false, releases: expect.any(Array), inAbout: true },
      opened: {
        menuDot: false,
        panelShown: true,
        expanded: "true",
        releases: expect.any(Array),
      },
      closed: false,
      afterReload: { menuDot: false, panelShown: false, releases: expect.any(Array) },
      version: `v${versions[0]}`,
      newestFirst: true,
    });
  });

  test("a player who saw the last shipped release sees the dot again, and What's new opens on the unshipped releases, newest first, with the next shipped one below them", () => {
    localStorage.setItem(SEEN_RELEASE_KEY, "2026.10.29");
    const page = loadPage("/");
    const { menuDot } = whatsNew(page);
    page.click("whats_new");
    const { releases } = whatsNew(page);
    page.close();
    expect({ menuDot, unshipped: releases.slice(0, 1).map((release) => release.version), next: releases[1] }).toEqual({
      menuDot: true, unshipped: ["2026.10.31"], next: NEXT_RELEASE,
    });
  });

  test("What's new lists the five newest releases, 2026.10.31 with the co-op notes, and links the older ones to GitHub Releases", () => {
    const page = loadPage("/");
    page.click("whats_new");
    const { releases } = whatsNew(page);
    const older = [...page.element("whats_new_panel").querySelectorAll("a")].map((link) => [link.textContent, link.href, link.target, link.rel]);
    page.close();
    expect({ versions: releases.map((release) => release.version), newest: releases[0]?.notes, older }).toEqual({
      versions: SHOWN_VERSIONS,
      newest: expect.arrayContaining([COOP_NOTE]),
      older: [["Older releases", "https://github.com/Julian-Dasilva/ArchiveOcellusTrainer/releases", "_blank", "noopener noreferrer"]],
    });
  });

  test("opening What's new from the keyboard moves focus to the panel's title", () => {
    const page = loadPage("/");
    page.element("whats_new").focus();
    page.click("whats_new");
    const focused = document.activeElement?.id;
    page.close();
    expect(focused).toBe("whats_new_title");
  });

  test.each([
    ["Close", (page: ReturnType<typeof loadPage>) => page.click("whats_new_close")],
    ["Escape", (page: ReturnType<typeof loadPage>) => page.press("Escape", page.element("whats_new_close"))],
  ])("closing What's new with %s returns focus to What's new", (_, close) => {
    const page = loadPage("/");
    page.click("whats_new");
    page.element("whats_new_close").focus();
    close(page);
    const closed = { focused: document.activeElement?.id, panelShown: page.element("whats_new_panel").hidden === false };
    page.close();
    expect(closed).toEqual({ focused: "whats_new", panelShown: false });
  });

  test("storage that throws for the seen release still opens the panel and clears the dot for the visit", () => {
    // Blocked storage is a browser boundary; the SDK's own settings keys stay readable so the page can load.
    const { getItem, setItem } = Storage.prototype;
    const blocked = (key: string) => {
      if (key === SEEN_RELEASE_KEY) throw new DOMException("storage is blocked", "SecurityError");
    };
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      blocked(key);
      return getItem.call(this, key);
    });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      blocked(key);
      setItem.call(this, key, value);
    });
    const page = loadPage("/");
    const onLoad = whatsNew(page);
    page.click("whats_new");
    const opened = whatsNew(page);
    page.close();
    read.mockRestore();
    write.mockRestore();

    expect({ onLoad: onLoad.menuDot, opened: [opened.menuDot, opened.panelShown, opened.releases.map((release) => release.version)] }).toEqual({
      onLoad: true,
      opened: [false, true, SHOWN_VERSIONS],
    });
  });
});
