import { describe, expect, it } from "vitest";
import { displayRoadNumber, normalizeRoadNumber, toNvdbRoadFilter } from "../src/domain/roads.js";

describe("normalizeRoadNumber", () => {
  it.each([
    ["E6", "E6"],
    ["e 6", "E6"],
    ["Ev6", "E6"],
    ["EV 39", "E39"],
    ["Rv. 706", "R706"],
    ["rv706", "R706"],
    ["Fv704", "F704"],
    ["fv. 6650", "F6650"],
    ["Fylkesvei 714", "F714"],
    ["K3060", "K3060"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeRoadNumber(input)).toBe(expected);
  });

  it.each(["", "6", "X6", "E", "Rv-abc"])("avviser %s", (input) => {
    expect(normalizeRoadNumber(input)).toBeNull();
  });

  it("lager NVDB-filter og visningsnavn", () => {
    expect(toNvdbRoadFilter("E6")).toBe("EV6");
    expect(toNvdbRoadFilter("F714")).toBe("FV714");
    expect(displayRoadNumber("R706")).toBe("Rv. 706");
  });
});
