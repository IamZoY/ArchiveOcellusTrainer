import { describe, expect, it } from "vitest";
import { nextTarget, whoToWatch } from "./session";
import type { Standing } from "./session";
import type { Member } from "./protocol";

const member = (id: string, dead = false): Member => ({ id, name: id, ready: true, host: id === "a", dead, gear: null });

describe("who the boss is on", () => {
  it("picks the first living player when nobody is chosen yet", () => {
    expect(nextTarget([member("a"), member("b")], null)).toBe("a");
  });

  it("stays on the same player while they live, so the boss does not flicker between people", () => {
    const roster = [member("a"), member("b")];
    expect(nextTarget(roster, "b")).toBe("b");
    expect(nextTarget(roster, "b")).toBe("b");
  });

  it("moves on when the chosen player dies", () => {
    expect(nextTarget([member("a", true), member("b")], "a")).toBe("b");
  });

  it("gives up when everyone is down", () => {
    expect(nextTarget([member("a", true), member("b", true)], "a")).toBeNull();
    expect(nextTarget([], null)).toBeNull();
  });

  it("ignores a chosen player who has left the room", () => {
    expect(nextTarget([member("b"), member("c")], "gone")).toBe("b");
  });
});

const standing = (id: string, dead = false): Standing => ({ id, dead });

describe("who a dead player watches", () => {
  it("picks the first player still standing", () => {
    expect(whoToWatch(null, [standing("a"), standing("b")])).toBe("a");
  });

  it("stays on the one being watched, so the camera does not hop as the roster reorders", () => {
    const others = [standing("a"), standing("b")];
    expect(whoToWatch("b", others)).toBe("b");
    expect(whoToWatch("b", [...others].reverse())).toBe("b");
  });

  it("moves on when the watched player dies too", () => {
    expect(whoToWatch("a", [standing("a", true), standing("b")])).toBe("b");
  });

  it("watches nobody once the whole team is down", () => {
    expect(whoToWatch("a", [standing("a", true), standing("b", true)])).toBeNull();
    expect(whoToWatch(null, [])).toBeNull();
  });

  it("moves on when the watched player leaves the room", () => {
    expect(whoToWatch("gone", [standing("b")])).toBe("b");
  });

  it("skips the dead to find someone alive further down", () => {
    expect(whoToWatch(null, [standing("a", true), standing("b", true), standing("c")])).toBe("c");
  });
});
