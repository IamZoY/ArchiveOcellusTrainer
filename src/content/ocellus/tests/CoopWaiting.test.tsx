/**
 * A page that belongs to a room does not offer a Start of its own: the fight is the room's, so it says who the
 * party is still waiting for, and only the host has the button. This is the whole point of the gate, so it is
 * tested against the real page with a room standing in for the server.
 */
import React, { act } from "react";
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { Trainer, TrainerInstance, Viewport } from "osrs-sdk";
import type { TrainerLoadingState } from "osrs-sdk";
import { FightRegion } from "../full/region";
import { FullFightPage } from "../full/page";
import { mountPage } from "./page";
import type { Member, Roster, ServerEvent } from "../../../multiplayer/protocol";

const READY: TrainerLoadingState = { assetProgress: 1, assetsLoaded: 0, assetsReady: true, assetsTotal: 0, imagesReady: true, status: "ready", viewportReady: true };
const CODE = "CRDGUR";
const ME = "zoy";
const HOST = "ziad";

const member = (id: string, name: string, host: boolean, ready: boolean): Member => ({ id, name, ready, host, dead: false, gear: null });

/** A room server, answered from here: the seat comes back from the join, the rest down the stream. */
function fakeRoom() {
  const streams: { send(event: ServerEvent): void }[] = [];
  const asked: string[] = [];

  class FakeStream {
    onmessage: ((message: Readonly<{ data: string }>) => void) | null = null;
    onerror: (() => void) | null = null;
    private readonly listeners = new Map<string, (event: Event) => void>();

    constructor(readonly url: string) {
      streams.push({
        send: (event) => {
          const frame = new Event(event.kind);
          Reflect.set(frame, "data", JSON.stringify(event));
          this.listeners.get(event.kind)?.(frame);
        },
      });
    }

    addEventListener(kind: string, listener: (event: Event) => void): void {
      this.listeners.set(kind, listener);
    }

    close(): void {}
  }

  vi.stubGlobal("EventSource", FakeStream);
  vi.stubGlobal("fetch", (url: string) => {
    asked.push(url);
    const seat = { code: CODE, playerId: ME, token: "t0ken", seed: 1, startPhase: 4, host: false };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(seat) });
  });

  return {
    asked,
    send: (event: ServerEvent) => act(() => streams.forEach((stream) => stream.send(event))),
    welcome: (roster: Roster, started = false) => ({ kind: "welcome", you: ME, code: CODE, seed: 1, startPhase: 4, roster, started }) as const,
  };
}

async function openPage(url: string) {
  const page = mountPage(url, <FullFightPage />);
  if (!(Trainer.player.region instanceof FightRegion)) throw new Error("the page built no full fight");
  // The join is a promise, and the stream's welcome lands after it.
  await act(() => Promise.resolve());
  await act(() => Promise.resolve());
  return page;
}

const text = (id: string) => document.getElementById(id)?.textContent ?? null;
const panel = () => document.getElementById("coop_wait")?.textContent ?? null;

describe("a page that belongs to a room", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    vi.spyOn(TrainerInstance.prototype, "load").mockImplementation(async (options) => options?.onStateChange?.(READY));
    vi.spyOn(Viewport.prototype, "draw").mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("a guest is told who the party is waiting for, and is never offered a Start of its own", async () => {
    localStorage.setItem("archive-ocellus-coop-name", "Zoy");
    const room = fakeRoom();
    const page = await openPage(`/?seed=1&phase=4&room=${CODE}`);

    // Joining, before the room has said anything: no Start either, or a guest could run the fight alone.
    const joining = { start: text("start"), wait: panel() };

    room.send(room.welcome([member(HOST, "Ziad", true, true), member(ME, "Zoy", false, false)]));
    const waiting = { start: text("start"), wait: panel(), canStart: document.getElementById("coop_wait_start") !== null };

    room.send(room.welcome([member(HOST, "Ziad", true, true), member(ME, "Zoy", false, true)]));
    const readied = panel();

    page.close();

    expect({ joining, waiting, readied }).toEqual({
      joining: { start: null, wait: "Joining…Finding the room." },
      waiting: { start: null, wait: expect.stringContaining("Waiting for the party"), canStart: false },
      readied: expect.stringContaining("The host starts the fight."),
    });
    expect(waiting.wait).toContain("Waiting for you.");
  });

  test("the host is told who is not ready yet, and gets the Start once everyone is", async () => {
    localStorage.setItem("archive-ocellus-coop-name", "Ziad");
    const room = fakeRoom();
    const page = await openPage(`/?seed=1&phase=4&room=${CODE}`);
    const asHost = (ready: boolean) => room.welcome([member(ME, "Ziad", true, true), member(HOST, "Zoy", false, ready)]);

    room.send(asHost(false));
    const start = () => document.getElementById("coop_wait_start");
    const waiting = { title: panel(), disabled: start()?.hasAttribute("disabled") };

    room.send(asHost(true));
    const ready = { title: panel(), disabled: start()?.hasAttribute("disabled") };

    page.close();

    expect({ waiting, ready }).toEqual({
      waiting: { title: expect.stringContaining("Waiting for Zoy."), disabled: true },
      ready: { title: expect.stringContaining("Everyone is ready."), disabled: false },
    });
    expect(ready.title).toContain("Your party");
  });

  test("Copy link hands a friend the room and the fight, but not the kit", async () => {
    localStorage.setItem("archive-ocellus-coop-name", "Zoy");
    const room = fakeRoom();
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      } });
    const page = await openPage(`/?seed=1&phase=4&tier=max&room=${CODE}`);
    room.send(room.welcome([member(HOST, "Ziad", true, true), member(ME, "Zoy", false, true)]));

    page.click("coop_link");
    await act(() => Promise.resolve());
    const link = new URL(copied[0] ?? "http://nothing/");
    const said = document.getElementById("coop_link")?.textContent;
    page.close();

    expect({ room: link.searchParams.get("room"), seed: link.searchParams.get("seed"), phase: link.searchParams.get("phase"), tier: link.searchParams.get("tier"), said }).toEqual({
      room: CODE,
      seed: "1",
      phase: "4",
      tier: null,
      said: "Link copied",
    });
  });

  test("alone, the page still offers its own Start", async () => {
    const page = await openPage("/?seed=1&phase=4");
    const alone = { start: text("start"), wait: panel() };
    page.close();
    expect(alone).toEqual({ start: "Start", wait: null });
  });
});
