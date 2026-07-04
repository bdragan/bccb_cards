export const cpuLevelProgressStorageKey = "card-games-cpu-level-progress-v1";

export const cpuLevelNames = [
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Master",
  "Grandmaster",
] as const;

export type CpuLevelName = (typeof cpuLevelNames)[number];

export type CpuLevelProgress = {
  level: CpuLevelName;
  points: number;
  highestLevel: CpuLevelName;
  highestPoints: number;
};

export type CpuLevelResult = "win" | "loss";

const defaultCpuLevelProgress: CpuLevelProgress = {
  level: "Bronze",
  points: 1,
  highestLevel: "Bronze",
  highestPoints: 1,
};

function levelIndex(level: CpuLevelName) {
  return cpuLevelNames.indexOf(level);
}

function isCpuLevelName(value: unknown): value is CpuLevelName {
  return (
    typeof value === "string" && cpuLevelNames.includes(value as CpuLevelName)
  );
}

export function isGrandmasterLevel(level: CpuLevelName) {
  return level === "Grandmaster";
}

export function cpuLevelPointThreshold(level: CpuLevelName) {
  if (isGrandmasterLevel(level)) {
    return undefined;
  }

  return 3 + levelIndex(level);
}

function normalizeLevelPoints(level: CpuLevelName, points: unknown) {
  const normalizedPoints =
    typeof points === "number" ? Math.max(1, Math.floor(points)) : 1;

  if (isGrandmasterLevel(level)) {
    return normalizedPoints;
  }

  return Math.min(normalizedPoints, lastPointBeforePromotion(level));
}

function lastPointBeforePromotion(level: CpuLevelName) {
  return (cpuLevelPointThreshold(level) ?? 1) - 1;
}

function compareCpuLevelProgress(
  left: Pick<CpuLevelProgress, "level" | "points">,
  right: Pick<CpuLevelProgress, "level" | "points">,
) {
  const levelDifference = levelIndex(left.level) - levelIndex(right.level);

  if (levelDifference !== 0) {
    return levelDifference;
  }

  return left.points - right.points;
}

export function normalizeCpuLevelProgress(progress: unknown): CpuLevelProgress {
  const candidate =
    progress && typeof progress === "object"
      ? (progress as Partial<CpuLevelProgress>)
      : undefined;

  if (
    !isCpuLevelName(candidate?.level) ||
    typeof candidate.points !== "number"
  ) {
    return { ...defaultCpuLevelProgress };
  }

  const current = {
    level: candidate.level,
    points: normalizeLevelPoints(candidate.level, candidate.points),
  };
  const storedHighestLevel = isCpuLevelName(candidate.highestLevel)
    ? candidate.highestLevel
    : current.level;
  const storedHighest = {
    level: storedHighestLevel,
    points: normalizeLevelPoints(storedHighestLevel, candidate.highestPoints),
  };
  const highest =
    compareCpuLevelProgress(current, storedHighest) > 0
      ? current
      : storedHighest;

  return {
    ...current,
    highestLevel: highest.level,
    highestPoints: highest.points,
  };
}

export function applyCpuLevelResult(
  progress: unknown,
  result: CpuLevelResult,
): CpuLevelProgress {
  const normalized = normalizeCpuLevelProgress(progress);
  const currentIndex = levelIndex(normalized.level);
  let next: Pick<CpuLevelProgress, "level" | "points">;

  if (result === "win") {
    if (isGrandmasterLevel(normalized.level)) {
      next = { level: normalized.level, points: normalized.points + 1 };
    } else {
      const nextPoints = normalized.points + 1;
      const threshold = cpuLevelPointThreshold(normalized.level);

      if (threshold && nextPoints >= threshold) {
        next = { level: cpuLevelNames[currentIndex + 1], points: 1 };
      } else {
        next = { level: normalized.level, points: nextPoints };
      }
    }
  } else if (normalized.points > 1) {
    next = { level: normalized.level, points: normalized.points - 1 };
  } else if (normalized.level === "Bronze") {
    next = { level: "Bronze", points: 1 };
  } else {
    const previousLevel = cpuLevelNames[currentIndex - 1];

    next = {
      level: previousLevel,
      points: lastPointBeforePromotion(previousLevel),
    };
  }

  return normalizeCpuLevelProgress({
    ...next,
    highestLevel: normalized.highestLevel,
    highestPoints: normalized.highestPoints,
  });
}

export function readCpuLevelProgress(): CpuLevelProgress {
  try {
    const stored = window.localStorage.getItem(cpuLevelProgressStorageKey);

    if (!stored) {
      return { ...defaultCpuLevelProgress };
    }

    return normalizeCpuLevelProgress(JSON.parse(stored) as unknown);
  } catch {
    return { ...defaultCpuLevelProgress };
  }
}

export function writeCpuLevelProgress(progress: CpuLevelProgress) {
  try {
    window.localStorage.setItem(
      cpuLevelProgressStorageKey,
      JSON.stringify(normalizeCpuLevelProgress(progress)),
    );
  } catch {
    // Local progress is optional. The game should stay playable without it.
  }
}
