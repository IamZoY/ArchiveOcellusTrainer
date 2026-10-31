import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ControlPanelController, Settings, SoundCache } from "osrs-sdk";
import type { SettingsState } from "osrs-sdk";
import { DefaultSidebar, RuneScapeButton, useSettingsSnapshot } from "osrs-sdk-react";
import { flushSync } from "react-dom";
import { CHANGELOG } from "../content/ocellus/changelog";
import type { ReleaseVersion } from "../releases";
import { releaseDate } from "../releases";
import { perfDataAllowed, setPerfDataAllowed } from "../telemetry/perfTelemetry";
import { CONTRIBUTOR, CREDIT_LINE, MAKER, MAKER_LINKS, REPOSITORY_URL } from "./credits";

const [LATEST_RELEASE] = CHANGELOG;

type SettingToggle = "targetTileEnabled" | "trueTileEnabled" | "hoveredTileEnabled" | "entityIndicatorEnabled" | "playsAudio" | "playsAreaAudio" | "fixedMode";

type Toggle = Readonly<{ id: string; setting: SettingToggle; label: string; hint: string | null }>;

const TILE_INDICATORS: readonly Toggle[] = [
  { id: "destination_tile", setting: "targetTileEnabled", label: "Destination tile", hint: "Where you clicked" },
  { id: "true_tile", setting: "trueTileEnabled", label: "True tile", hint: "Where the server has you" },
  { id: "hovered_tile", setting: "hoveredTileEnabled", label: "Hovered tile", hint: null },
  { id: "entity_outlines", setting: "entityIndicatorEnabled", label: "Outlines", hint: "Players and NPCs" },
];

const DISPLAY: readonly Toggle[] = [
  { id: "fixed_mode", setting: "fixedMode", label: "Fixed mode", hint: "The classic 765 by 503 interface" },
];

const SOUNDS: readonly Toggle[] = [
  { id: "sound", setting: "playsAudio", label: "Sound effects", hint: null },
  { id: "area_sound", setting: "playsAreaAudio", label: "Area sounds", hint: null },
];

function setToggle(setting: SettingToggle, on: boolean) {
  const patch: Partial<Pick<SettingsState, SettingToggle>> = {};
  patch[setting] = on;
  Settings.set(patch);
  void SoundCache.context?.resume();
}

function SettingToggles({ toggles }: Readonly<{ toggles: readonly Toggle[] }>) {
  const settings = useSettingsSnapshot();
  return toggles.map(({ id, setting, label, hint }) => (
    <label key={id}>
      {label}
      {hint !== null && <small>{hint}</small>}
      <input id={id} type="checkbox" checked={settings[setting]} onChange={(event) => setToggle(setting, event.target.checked)} />
    </label>
  ));
}

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

function phoneLayout(): boolean {
  const mobile: unknown = Settings.mobileCheck();
  return mobile === true;
}

function PhoneMenuButton() {
  const { menuVisible } = useSettingsSnapshot();
  if (!phoneLayout()) return null;
  return (
    <button id="phone_menu" type="button" aria-expanded={menuVisible} onClick={() => Settings.setMenuVisible(!menuVisible)}>
      {menuVisible ? "Close" : "Menu"}
    </button>
  );
}

function Credits() {
  return (
    <ul id="sidebar_credits">
      <li id="sidebar_maker">
        Made by {MAKER}:{" "}
        {MAKER_LINKS.map((link, i) => (
          <React.Fragment key={link.href}>
            {i > 0 && " · "}
            <a href={link.href} {...external}>{link.label}</a>
          </React.Fragment>
        ))}
      </li>
      <li id="sidebar_contributor">
        With help from <a href={CONTRIBUTOR.href} {...external}>{CONTRIBUTOR.label}</a>
      </li>
    </ul>
  );
}

function openKeybinds() {
  ControlPanelController.controller.setActiveControl("SETTINGS");
  if (phoneLayout()) Settings.setMenuVisible(false);
}

function PolicyFooter({ menu }: Readonly<{ menu: ReactNode }>) {
  return (
    <footer id="policy_footer">
      <Credits />
      <p id="credit_line">{CREDIT_LINE}</p>
      <p id="app_version">v{LATEST_RELEASE.version}</p>
      {menu}
    </footer>
  );
}

function Section({ id, title, children }: Readonly<{ id: string; title: string; children: ReactNode }>) {
  return (
    <section id={id}>
      <h4 className="sidebar_title">{title}</h4>
      {children}
    </section>
  );
}

// #right_panel is the SDK's only scroll container; nothing inside may scroll, or its scrollbar narrows the panel and clips the rows.
// The What's new panel keeps its popup id, so the sidebar resets that popup styling in place.
// The SDK draws its tabs and inventory on the canvas, so the policy strip takes a grid row under the canvas and the panel. TrainerApp sets display inline and DefaultSidebar sets the panel width inline, hence !important.
// #trainer-loading is z-index 1000 and takes hits. The phone panel paints above it, and the footer above the panel.
const SIDEBAR_CSS = `
div:has(> #right_panel) { display: grid !important; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: minmax(0, 1fr) auto; }
#policy_footer { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 4px 8px; padding: 3px 6px; background: #1b160f; border-top: 1px solid #3e3529; color: #c8b88a; font-size: 11px; }
#policy_footer #sidebar_credits { flex: 1 1 100%; margin: 0; padding-left: 16px; color: #e8dcc0; font-size: 13px; line-height: 15px; }
#policy_footer #sidebar_credits a { color: #ff981f; }
#policy_footer #credit_line { flex: 1 1 0; max-width: none; margin: 0; }
#policy_footer #app_version { margin: 0; white-space: nowrap; opacity: 0.8; }
#policy_footer #phone_menu { flex: 0 0 auto; margin: 0 0 0 auto; padding: 2px 8px; border: 1px solid #6b5b3e; background: #2b2418; color: #ff981f; font: inherit; }
html.phone-overlay div:has(> #right_panel) { grid-template-columns: minmax(0, 1fr); }
html.phone-overlay #right_panel { position: fixed; top: 0; right: 0; width: min(280px, 92vw) !important; height: auto !important; max-height: 100%; z-index: 1001; }
html.phone-overlay #policy_footer { position: relative; z-index: 1002; }
#right_panel { overflow-x: hidden; }
#sidebar { display: flex; flex-direction: column; gap: 10px; min-width: 0; font-size: 14px; color: #ff981f; overflow-wrap: anywhere; }
#sidebar h3 { margin: 2px 0 0; font-weight: normal; font-size: 24px; text-align: center; }
#sidebar .sidebar_subtitle { margin-top: -8px; text-align: center; font-size: 13px; color: #c8b88a; }
#sidebar > section { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid #6b5b3e; }
#sidebar .sidebar_title { margin: 0; font-weight: normal; font-size: 15px; color: #ff981f; }
#sidebar > section > form, #sidebar > section > div { display: contents; }
#sidebar label { display: flex; flex-direction: column; gap: 3px; color: #ffcf8a; }
#sidebar label:has(> input[type="checkbox"]) { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; align-items: center; }
#sidebar label > input[type="checkbox"] { grid-column: 2; grid-row: 1 / span 2; margin: 0; }
#sidebar label > small { grid-column: 1; font-size: 12px; color: #a89a78; }
#sidebar select, #sidebar #seed { font: inherit; width: 100%; box-sizing: border-box; padding: 2px; border: 1px solid #6b5b3e; background: #2b2418; color: #fff; }
#sidebar button { width: 100%; }
#sidebar #whats_new_panel { position: static; box-sizing: border-box; width: auto; max-height: none; overflow: visible; }
#sidebar ul { margin: 0; padding-left: 16px; color: #e8dcc0; font-size: 13px; line-height: 15px; }
#sidebar li { margin-bottom: 5px; }
#sidebar a { color: #ff981f; }
#sidebar #loadout_note, #sidebar #loadout_editor small { font-size: 12px; color: #a89a78; }
#sidebar #loadout_editor { display: flex; flex-direction: column; gap: 6px; padding: 6px; border: 1px solid #6b5b3e; background: #1b160f; }
#sidebar #loadout_editor h3 { margin: 0; font-size: 15px; text-align: left; }
#sidebar #loadout_editor p { margin: 0; font-size: 13px; color: #e8dcc0; }
`;

const SEEN_RELEASE_KEY = "archive-ocellus:seen-release";

function seenRelease(): string | null {
  try {
    return localStorage.getItem(SEEN_RELEASE_KEY);
  } catch {
    return null;
  }
}

function rememberSeenRelease(version: ReleaseVersion) {
  try {
    localStorage.setItem(SEEN_RELEASE_KEY, version);
  } catch {}
}

const UnseenDot = () => <span className="unseen_dot" role="img" aria-label="new" />;

function About() {
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(() => seenRelease() !== LATEST_RELEASE.version);
  const [sendsPerfData, setSendsPerfData] = useState(perfDataAllowed);
  const about = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  const show = () => {
    rememberSeenRelease(LATEST_RELEASE.version);
    flushSync(() => {
      setOpen(true);
      setUnseen(false);
    });
    title.current?.focus();
  };

  const hide = () => {
    setOpen(false);
    about.current?.querySelector<HTMLButtonElement>("#whats_new")?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const closeOutside = (event: Event) => {
      if (!(event.target instanceof Node && about.current?.contains(event.target))) setOpen(false);
    };
    // Capture, because the SDK canvas stops its events from bubbling.
    document.addEventListener("keydown", closeOnEscape, true);
    document.addEventListener("pointerdown", closeOutside, true);
    return () => {
      document.removeEventListener("keydown", closeOnEscape, true);
      document.removeEventListener("pointerdown", closeOutside, true);
    };
  }, [open]);

  return (
    <div ref={about}>
      <label>
        Performance data
        <small>Sent anonymously</small>
        <input id="perf_data" type="checkbox" checked={sendsPerfData} onChange={(event) => { setPerfDataAllowed(event.target.checked); setSendsPerfData(event.target.checked); }} />
      </label>
      <RuneScapeButton id="whats_new" type="button" aria-expanded={open} onClick={open ? hide : show}>What's new{unseen && <UnseenDot />}</RuneScapeButton>
      <section id="whats_new_panel" role="dialog" aria-labelledby="whats_new_title" hidden={!open}>
        <h2 id="whats_new_title" ref={title} tabIndex={-1}>What's new</h2>
        {CHANGELOG.map(({ version, notes }) => (
          <article key={version}>
            <h3><time dateTime={releaseDate(version)}>{version}</time></h3>
            <ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul>
          </article>
        ))}
        <p><a href={`${REPOSITORY_URL}/releases`} target="_blank" rel="noopener noreferrer">Older releases</a></p>
        <button id="whats_new_close" type="button" onClick={hide}>Close</button>
      </section>
    </div>
  );
}

export type SidebarSlots = Readonly<{ fight: ReactNode; aids: ReactNode; tips: ReactNode; coop?: ReactNode }>;

export default function Sidebar({ fight, aids, tips, coop }: SidebarSlots) {
  useLayoutEffect(() => {
    if (!phoneLayout()) return;
    const root = document.documentElement;
    const footer = document.getElementById("policy_footer");
    const panel = document.getElementById("right_panel");
    root.classList.add("phone-overlay");
    // The footer paints above this overlay, so the panel ends at the footer's top.
    const fit = () => {
      if (!(footer instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;
      panel.style.bottom = `${footer.offsetHeight}px`;
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" || !(footer instanceof HTMLElement) ? null : new ResizeObserver(fit);
    if (observer !== null && footer instanceof HTMLElement) observer.observe(footer);
    return () => {
      observer?.disconnect();
      if (panel instanceof HTMLElement) panel.style.bottom = "";
      root.classList.remove("phone-overlay");
    };
  }, []);
  return (
    <>
      <DefaultSidebar>
        <style>{SIDEBAR_CSS}</style>
        <div id="sidebar">
          <h3>Ocellus</h3>
          <div className="sidebar_subtitle">The Fractured Archive</div>
          <Section id="sidebar_fight" title="Fight">{fight}</Section>
          {coop !== undefined && <Section id="sidebar_coop" title="Co-op">{coop}</Section>}
          <Section id="learning_aids" title="Learning aids">
            {aids}
            <SettingToggles toggles={TILE_INDICATORS} />
            {tips}
          </Section>
          <Section id="sidebar_display" title="Display">
            <SettingToggles toggles={DISPLAY} />
          </Section>
          <Section id="sidebar_sound" title="Sound">
            <SettingToggles toggles={SOUNDS} />
          </Section>
          <Section id="sidebar_controls" title="Controls">
            <RuneScapeButton id="keybinds" type="button" onClick={openKeybinds}>Keybinds</RuneScapeButton>
          </Section>
          <Section id="sidebar_about" title="About">
            <About />
          </Section>
        </div>
      </DefaultSidebar>
      <PolicyFooter menu={<PhoneMenuButton />} />
    </>
  );
}
