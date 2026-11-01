import { describe, expect, it } from "vitest";
import { fightLink, waitingOn } from "./Lobby";
import type { Member } from "./protocol";

const member = (id: string, name: string, ready: boolean): Member => ({ id, name, ready, host: id === "a", dead: false, gear: null });

describe("the link a friend is sent", () => {
  it("carries the room and the fight it is on", () => {
    const link = fightLink("http://box:8080/full?room=KPWCAV&seed=4242&phase=4&practice=1");
    expect(link).toContain("room=KPWCAV");
    expect(link).toContain("seed=4242");
    expect(link).toContain("phase=4");
    expect(link).toContain("practice=1");
  });

  it("leaves the kit out, since a link should not dress the person who opens it", () => {
    const link = fightLink("http://box:8080/full?room=KPWCAV&seed=1&phase=1&tier=bis&weapon=melee");
    expect(link).not.toContain("tier=");
    expect(link).not.toContain("weapon=");
  });
});

describe("what a page in a room is waiting for", () => {
  it("names whoever is not ready, and calls you you", () => {
    const roster = [member("a", "Zoy", true), member("b", "Ziad", false)];
    expect(waitingOn(roster, "a")).toBe("Waiting for Ziad.");
    expect(waitingOn(roster, "b")).toBe("Waiting for you.");
  });

  it("reads a list out as a person would", () => {
    const roster = [member("a", "Zoy", false), member("b", "Ziad", false), member("c", "Sam", false)];
    expect(waitingOn(roster, "d")).toBe("Waiting for Zoy, Ziad and Sam.");
  });

  it("says so once nobody is being waited for", () => {
    expect(waitingOn([member("a", "Zoy", true), member("b", "Ziad", true)], "a")).toBe("Everyone is ready.");
  });
});
