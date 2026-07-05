import { describe, expect, it } from "vitest";

import {
  applyCpuLevelResult,
  cpuLevelPointThreshold,
  cpuMaxSearchPliesForLevel,
  normalizeCpuLevelProgress,
} from "../progress/cpu-levels";

describe("CPU level progress", () => {
  it("exposes point thresholds for ranks below Grandmaster", () => {
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
      highestLevel: "Bronze",
      highestPoints: 1,
    });
  });

  it("sets CPU max search plies from the current rank", () => {
    expect(cpuMaxSearchPliesForLevel("Bronze", 14)).toBe(10);
    expect(cpuMaxSearchPliesForLevel("Silver", 14)).toBe(10);
    expect(cpuMaxSearchPliesForLevel("Gold", 14)).toBe(10);
    expect(cpuMaxSearchPliesForLevel("Platinum", 14)).toBe(12);
    expect(cpuMaxSearchPliesForLevel("Diamond", 14)).toBe(12);
    expect(cpuMaxSearchPliesForLevel("Master", 14)).toBe(14);
    expect(cpuMaxSearchPliesForLevel("Grandmaster", 14)).toBe(14);
    expect(cpuMaxSearchPliesForLevel("Bronze", 3)).toBe(1);
  });

  it("caps saved non-Grandmaster points to the last point before promotion", () => {
    expect(normalizeCpuLevelProgress({ level: "Silver", points: 5 })).toEqual({
      level: "Silver",
      points: 3,
      highestLevel: "Silver",
      highestPoints: 3,
    });
    expect(normalizeCpuLevelProgress({ level: "Master", points: 12 })).toEqual({
      level: "Master",
      points: 7,
      highestLevel: "Master",
      highestPoints: 7,
    });
  });

  it("adds points before promoting to the next rank after a win", () => {
    expect(applyCpuLevelResult({ level: "Bronze", points: 1 }, "win")).toEqual({
      level: "Bronze",
      points: 2,
      highestLevel: "Bronze",
      highestPoints: 2,
    });
    expect(applyCpuLevelResult({ level: "Bronze", points: 2 }, "win")).toEqual({
      level: "Silver",
      points: 1,
      highestLevel: "Silver",
      highestPoints: 1,
    });
    expect(applyCpuLevelResult({ level: "Master", points: 7 }, "win")).toEqual({
      level: "Grandmaster",
      points: 1,
      highestLevel: "Grandmaster",
      highestPoints: 1,
    });
  });

  it("removes points before demoting to the previous rank after a loss", () => {
    expect(applyCpuLevelResult({ level: "Silver", points: 2 }, "loss")).toEqual(
      {
        level: "Silver",
        points: 1,
        highestLevel: "Silver",
        highestPoints: 2,
      },
    );
    expect(applyCpuLevelResult({ level: "Silver", points: 1 }, "loss")).toEqual(
      {
        level: "Bronze",
        points: 2,
        highestLevel: "Silver",
        highestPoints: 1,
      },
    );
    expect(
      applyCpuLevelResult({ level: "Grandmaster", points: 1 }, "loss"),
    ).toEqual({
      level: "Master",
      points: 7,
      highestLevel: "Grandmaster",
      highestPoints: 1,
    });
  });

  it("keeps Bronze losses at Bronze", () => {
    expect(applyCpuLevelResult({ level: "Bronze", points: 1 }, "loss")).toEqual(
      {
        level: "Bronze",
        points: 1,
        highestLevel: "Bronze",
        highestPoints: 1,
      },
    );
  });

  it("keeps Grandmaster wins as visible points", () => {
    expect(
      applyCpuLevelResult({ level: "Grandmaster", points: 17 }, "win"),
    ).toEqual({
      level: "Grandmaster",
      points: 18,
      highestLevel: "Grandmaster",
      highestPoints: 18,
    });
  });

  it("keeps Grandmaster losses as visible points until Grandmaster 1", () => {
    expect(
      applyCpuLevelResult({ level: "Grandmaster", points: 17 }, "loss"),
    ).toEqual({
      level: "Grandmaster",
      points: 16,
      highestLevel: "Grandmaster",
      highestPoints: 17,
    });
  });

  it("preserves the saved highest rank through lower current ranks", () => {
    expect(
      normalizeCpuLevelProgress({
        level: "Gold",
        points: 2,
        highestLevel: "Grandmaster",
        highestPoints: 6,
      }),
    ).toEqual({
      level: "Gold",
      points: 2,
      highestLevel: "Grandmaster",
      highestPoints: 6,
    });
  });

  it("preserves the highest saved points within the same rank", () => {
    expect(
      normalizeCpuLevelProgress({
        level: "Gold",
        points: 2,
        highestLevel: "Gold",
        highestPoints: 3,
      }),
    ).toEqual({
      level: "Gold",
      points: 2,
      highestLevel: "Gold",
      highestPoints: 3,
    });
  });
});
