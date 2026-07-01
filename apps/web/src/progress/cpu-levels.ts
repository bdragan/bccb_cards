export const cpuLevelProgressStorageKey =
  "card-games-cpu-level-progress-v1";

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
};

export type CpuLevelResult = "win" | "loss";

const defaultCpuLevelProgress: CpuLevelProgress = {
  level: "Bronze",
  points: 1,
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

  return 3 + levelIndex(level) * 2;
}

function lastPointBeforePromotion(level: CpuLevelName) {
  return (cpuLevelPointThreshold(level) ?? 1) - 1;
}

export function normalizeCpuLevelProgress(
  progress: unknown,
): CpuLevelProgress {
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

  const points = Math.max(1, Math.floor(candidate.points));

  if (isGrandmasterLevel(candidate.level)) {
    return { level: candidate.level, points };
  }

  return {
    level: candidate.level,
    points: Math.min(points, lastPointBeforePromotion(candidate.level)),
  };
}

export function applyCpuLevelResult(
  progress: CpuLevelProgress,
  result: CpuLevelResult,
): CpuLevelProgress {
  const normalized = normalizeCpuLevelProgress(progress);
  const currentIndex = levelIndex(normalized.level);

  if (result === "win") {
    if (isGrandmasterLevel(normalized.level)) {
      return { ...normalized, points: normalized.points + 1 };
    }

    const nextPoints = normalized.points + 1;
    const threshold = cpuLevelPointThreshold(normalized.level);

    if (threshold && nextPoints >= threshold) {
      return { level: cpuLevelNames[currentIndex + 1], points: 1 };
    }

    return { ...normalized, points: nextPoints };
  }

  if (normalized.points > 1) {
    return { ...normalized, points: normalized.points - 1 };
  }

  if (normalized.level === "Bronze") {
    return normalized;
  }

  const previousLevel = cpuLevelNames[currentIndex - 1];

  return {
    level: previousLevel,
    points: lastPointBeforePromotion(previousLevel),
  };
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
