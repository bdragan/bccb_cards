import { describe, expect, it } from "vitest";

import {
  applyCpuLevelResult,
  cpuLevelPointThreshold,
  normalizeCpuLevelProgress,
} from "../progress/cpu-levels";

describe("CPU level progress", () => {
  it("does not expose point thresholds for ranks", () => {
    expect(cpuLevelPointThreshold("Bronze")).toBeUndefined();
    expect(cpuLevelPointThreshold("Silver")).toBeUndefined();
    expect(cpuLevelPointThreshold("Gold")).toBeUndefined();
    expect(cpuLevelPointThreshold("Platinum")).toBeUndefined();
    expect(cpuLevelPointThreshold("Diamond")).toBeUndefined();
    expect(cpuLevelPointThreshold("Master")).toBeUndefined();
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

  it("migrates old non-Grandmaster saved points to rank-only progress", () => {
    expect(normalizeCpuLevelProgress({ level: "Silver", points: 5 })).toEqual({
      level: "Silver",
      points: 1,
      highestLevel: "Silver",
      highestPoints: 1,
    });
    expect(normalizeCpuLevelProgress({ level: "Master", points: 12 })).toEqual({
      level: "Master",
      points: 1,
      highestLevel: "Master",
      highestPoints: 1,
    });
  });

  it("promotes to the next rank after a win", () => {
    expect(applyCpuLevelResult({ level: "Bronze", points: 1 }, "win")).toEqual({
      level: "Silver",
      points: 1,
      highestLevel: "Silver",
      highestPoints: 1,
    });
    expect(applyCpuLevelResult({ level: "Master", points: 1 }, "win")).toEqual({
      level: "Grandmaster",
      points: 1,
      highestLevel: "Grandmaster",
      highestPoints: 1,
    });
  });

  it("demotes to the previous rank after a loss", () => {
    expect(applyCpuLevelResult({ level: "Silver", points: 1 }, "loss")).toEqual(
      {
        level: "Bronze",
        points: 1,
        highestLevel: "Silver",
        highestPoints: 1,
      },
    );
    expect(
      applyCpuLevelResult({ level: "Grandmaster", points: 17 }, "loss"),
    ).toEqual({
      level: "Master",
      points: 1,
      highestLevel: "Grandmaster",
      highestPoints: 17,
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

  it("preserves the saved highest rank through lower current ranks", () => {
    expect(
      normalizeCpuLevelProgress({
        level: "Gold",
        points: 1,
        highestLevel: "Grandmaster",
        highestPoints: 6,
      }),
    ).toEqual({
      level: "Gold",
      points: 1,
      highestLevel: "Grandmaster",
      highestPoints: 6,
    });
  });
});
