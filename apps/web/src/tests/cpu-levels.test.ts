import { describe, expect, it } from "vitest";

import {
  applyCpuLevelResult,
  cpuLevelPointThreshold,
  normalizeCpuLevelProgress,
} from "../progress/cpu-levels";

describe("CPU level progress", () => {
  it("uses increasing thresholds until Grandmaster", () => {
    expect(cpuLevelPointThreshold("Bronze")).toBe(3);
    expect(cpuLevelPointThreshold("Silver")).toBe(4);
    expect(cpuLevelPointThreshold("Gold")).toBe(5);
    expect(cpuLevelPointThreshold("Platinum")).toBe(6);
    expect(cpuLevelPointThreshold("Diamond")).toBe(7);
    expect(cpuLevelPointThreshold("Master")).toBe(8);
    expect(cpuLevelPointThreshold("Grandmaster")).toBeUndefined();
  });

  it("defaults new players to Bronze 1", () => {
    expect(normalizeCpuLevelProgress(undefined)).toEqual({
      level: "Bronze",
      points: 1,
    });
  });

  it("keeps over-capped saved progress one point short in the same level", () => {
    expect(normalizeCpuLevelProgress({ level: "Silver", points: 5 })).toEqual({
      level: "Silver",
      points: 3,
    });
    expect(normalizeCpuLevelProgress({ level: "Master", points: 12 })).toEqual({
      level: "Master",
      points: 7,
    });
  });

  it("promotes to the next level at the threshold with one starting point", () => {
    expect(applyCpuLevelResult({ level: "Bronze", points: 2 }, "win")).toEqual(
      {
        level: "Silver",
        points: 1,
      },
    );
    expect(applyCpuLevelResult({ level: "Master", points: 7 }, "win")).toEqual(
      {
        level: "Grandmaster",
        points: 1,
      },
    );
  });

  it("demotes after losing the last point in a level", () => {
    expect(applyCpuLevelResult({ level: "Silver", points: 1 }, "loss")).toEqual(
      {
        level: "Bronze",
        points: 2,
      },
    );
    expect(
      applyCpuLevelResult({ level: "Grandmaster", points: 1 }, "loss"),
    ).toEqual({
      level: "Master",
      points: 7,
    });
  });

  it("keeps Grandmaster uncapped", () => {
    expect(
      applyCpuLevelResult({ level: "Grandmaster", points: 17 }, "win"),
    ).toEqual({
      level: "Grandmaster",
      points: 18,
    });
  });
});
