import { describe, expect, it } from "vitest";
import { nextTarget } from "./session";
import type { Member } from "./protocol";

const member = (id: string, dead = false): Member => ({ id, name: id, ready: true, host: id === "a", dead });

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
