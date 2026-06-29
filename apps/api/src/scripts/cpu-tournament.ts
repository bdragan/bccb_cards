import { mkdir, rename, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import {
  isMainThread,
  parentPort,
  Worker,
  type WorkerOptions,
} from "node:worker_threads";

import {
  applyBelotAction,
  type BelotAction,
  type BelotHandResult,
  type BelotState,
  chooseBelotCpuAction,
  createBelotInitialState,
} from "@card-games/game-core";
import { createDeck } from "@card-games/game-core";
import type { Card } from "@card-games/shared";

const participantDepths = [6, 8, 10, 12, 14] as const;
const gamesPerMatchup = 10;
const monteCarloSamples = 64;
const maxGameActions = 10_000;

type TournamentJob = {
  id: number;
  gameNumber: number;
  depthA: number;
  depthB: number;
};

type TournamentGameResult = {
  id: number;
  gameNumber: number;
  depths: [number, number];
  players: Array<{
    playerId: string;
    displayName: string;
    searchDepth: number;
  }>;
  winnerDepth: number;
  winnerPlayerId: string;
  finalScoresByDepth: Record<string, number>;
  handResults: BelotHandResult[];
  durationMs: number;
};

type WorkerSuccess = {
  ok: true;
  result: TournamentGameResult;
};

type WorkerFailure = {
  ok: false;
  jobId: number;
  error: string;
};

type WorkerResponse = WorkerSuccess | WorkerFailure;

type TournamentFile = {
  generatedAt: string;
  configuration: {
    participantDepths: readonly number[];
    highestDepth: number;
    gamesPerMatchup: number;
    monteCarloSamples: number;
    workerCount: number;
  };
  games: TournamentGameResult[];
};

function cpuPlayerId(depth: number) {
  return `cpu-depth-${depth}`;
}

function shuffled<T>(values: readonly T[], rng: () => number) {
  const result = [...values];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function playedCardIds(state: BelotState) {
  return new Set([
    ...state.currentTrick.map((play) => play.card.id),
    ...state.completedTricks.flatMap((trick) =>
      trick.cards.map((play) => play.card.id),
    ),
  ]);
}

function cpuObservationState(
  state: BelotState,
  cpuId: string,
  rng: () => number,
): BelotState {
  const cpu = state.players.find((player) => player.playerId === cpuId);
  const opponent = state.players.find((player) => player.playerId !== cpuId);

  if (!cpu || !opponent) {
    throw new Error(`Cannot create a CPU observation for ${cpuId}`);
  }

  const playedIds = playedCardIds(state);
  const knownOpponentCards = (
    state.publicCardsByPlayer[opponent.playerId] ?? []
  ).filter((card) => !playedIds.has(card.id));
  const visibleCardIds = new Set<string>([
    ...cpu.hand.map((card) => card.id),
    ...state.currentTrick.map((play) => play.card.id),
    ...state.completedTricks.flatMap((trick) =>
      trick.cards.map((play) => play.card.id),
    ),
    ...Object.values(state.publicCardsByPlayer).flatMap((cards) =>
      cards.map((card) => card.id),
    ),
  ]);

  if (state.upcard) {
    visibleCardIds.add(state.upcard.id);
  }

  const unknownCards = shuffled(
    createDeck().filter((card) => !visibleCardIds.has(card.id)),
    rng,
  );
  let offset = 0;
  const takeUnknownCards = (count: number): Card[] => {
    const cards = unknownCards.slice(offset, offset + count);
    offset += count;

    if (cards.length !== count) {
      throw new Error("Not enough unknown cards to create a CPU observation");
    }

    return cards;
  };

  const sampledCpuHiddenCards = takeUnknownCards(cpu.hiddenCards.length);
  const sampledOpponentHand = [
    ...knownOpponentCards,
    ...takeUnknownCards(
      Math.max(0, opponent.hand.length - knownOpponentCards.length),
    ),
  ];
  const sampledOpponentHiddenCards = takeUnknownCards(
    opponent.hiddenCards.length,
  );

  return {
    ...state,
    deck: [],
    unusedCards: [],
    players: state.players.map((player) => {
      if (player.playerId === cpuId) {
        return {
          ...player,
          hiddenCards: sampledCpuHiddenCards,
          pickupCardIds: player.hiddenCards.length ? [] : player.pickupCardIds,
        };
      }

      return {
        ...player,
        hand: sampledOpponentHand,
        hiddenCards: sampledOpponentHiddenCards,
        pickupCardIds: [],
      };
    }),
  };
}

function nextCpuAction(
  state: BelotState,
  depthsByPlayerId: ReadonlyMap<string, number>,
  rng: () => number,
): BelotAction {
  let playerId: string | undefined;

  if (state.trumpTurnPlayerId) {
    playerId = state.trumpTurnPlayerId;
  } else if (state.phase === "declarations") {
    playerId = state.players.find(
      (player) =>
        !Object.prototype.hasOwnProperty.call(
          state.declarationsByPlayer,
          player.playerId,
        ),
    )?.playerId;
  } else if (state.phase === "trick-play") {
    playerId = state.currentTurnPlayerId;
  }

  if (!playerId) {
    throw new Error(`No CPU can act during phase ${state.phase}`);
  }

  const depth = depthsByPlayerId.get(playerId);

  if (!depth) {
    throw new Error(`No search depth is configured for ${playerId}`);
  }

  const action = chooseBelotCpuAction(
    cpuObservationState(state, playerId, rng),
    playerId,
    {
      maxSearchPlies: depth,
      trumpSearchPlies: depth,
      monteCarloSamples,
      rng,
    },
  );

  if (!action) {
    throw new Error(`${playerId} did not produce an action in ${state.phase}`);
  }

  return action;
}

function runGame(job: TournamentJob): TournamentGameResult {
  const startedAt = Date.now();
  const rng = Math.random;
  const playerAId = cpuPlayerId(job.depthA);
  const playerBId = cpuPlayerId(job.depthB);
  const depthsByPlayerId = new Map([
    [playerAId, job.depthA],
    [playerBId, job.depthB],
  ]);

  let state = createBelotInitialState([
    {
      playerId: playerAId,
      displayName: `CPU depth ${job.depthA}`,
    },
    {
      playerId: playerBId,
      displayName: `CPU depth ${job.depthB}`,
    },
  ]);

  for (const player of state.players) {
    state = applyBelotAction(state, {
      type: "set-ready",
      playerId: player.playerId,
      ready: true,
    });
  }

  let actionCount = 0;

  while (state.phase !== "finished") {
    if (actionCount >= maxGameActions) {
      throw new Error(`Game exceeded ${maxGameActions} actions`);
    }

    state =
      state.phase === "hand-complete"
        ? applyBelotAction(state, { type: "next-hand" })
        : applyBelotAction(state, nextCpuAction(state, depthsByPlayerId, rng));
    actionCount += 1;

    if (state.phase === "error") {
      throw new Error(state.error ?? "Belot game entered an error state");
    }
  }

  if (!state.winnerPlayerId) {
    throw new Error("Finished game has no winner");
  }

  const winnerDepth = depthsByPlayerId.get(state.winnerPlayerId);

  if (!winnerDepth) {
    throw new Error("Winner has no configured search depth");
  }

  return {
    id: job.id,
    gameNumber: job.gameNumber,
    depths: [job.depthA, job.depthB],
    players: state.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      searchDepth: depthsByPlayerId.get(player.playerId)!,
    })),
    winnerDepth,
    winnerPlayerId: state.winnerPlayerId,
    finalScoresByDepth: Object.fromEntries(
      state.players.map((player) => [
        String(depthsByPlayerId.get(player.playerId)),
        player.totalScore,
      ]),
    ),
    handResults: state.handResults ?? [],
    durationMs: Date.now() - startedAt,
  };
}

function createJobs(): TournamentJob[] {
  const jobs: TournamentJob[] = [];
  const highestDepth = Math.max(...participantDepths);

  for (const opponentDepth of participantDepths) {
    if (opponentDepth === highestDepth) {
      continue;
    }

    for (let gameNumber = 1; gameNumber <= gamesPerMatchup; gameNumber += 1) {
      const id = jobs.length + 1;
      jobs.push({
        id,
        gameNumber,
        depthA: opponentDepth,
        depthB: highestDepth,
      });
    }
  }

  return jobs;
}

async function writeTournamentFile(
  outputPath: string,
  workerCount: number,
  games: TournamentGameResult[],
) {
  const absolutePath = resolve(outputPath);
  const temporaryPath = `${absolutePath}.tmp`;
  const data: TournamentFile = {
    generatedAt: new Date().toISOString(),
    configuration: {
      participantDepths,
      highestDepth: Math.max(...participantDepths),
      gamesPerMatchup,
      monteCarloSamples,
      workerCount,
    },
    games: [...games].sort((left, right) => left.id - right.id),
  };

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temporaryPath, absolutePath);
}

function printGameResult(
  result: TournamentGameResult,
  completed: number,
  totalGames: number,
) {
  const [depthA, depthB] = result.depths;
  const scoreA = result.finalScoresByDepth[String(depthA)];
  const scoreB = result.finalScoresByDepth[String(depthB)];
  const seconds = (result.durationMs / 1_000).toFixed(1);

  console.log(
    `[${completed}/${totalGames}] depth ${depthA} vs ${depthB}, game ${result.gameNumber}: ` +
      `depth ${result.winnerDepth} won ${scoreA}-${scoreB} ` +
      `(${result.handResults.length} hands, ${seconds}s)`,
  );
}

function printHighestDepthSummary(results: TournamentGameResult[]) {
  const highestDepth = Math.max(...participantDepths);
  const highestDepthGames = results.filter((result) =>
    result.depths.includes(highestDepth),
  );
  const highestDepthWins = highestDepthGames.filter(
    (result) => result.winnerDepth === highestDepth,
  ).length;
  const matchScores = participantDepths
    .filter((depth) => depth !== highestDepth)
    .map((opponentDepth) => {
      const matchupResults = highestDepthGames.filter((result) =>
        result.depths.includes(opponentDepth),
      );
      const opponentWins = matchupResults.filter(
        (result) => result.winnerDepth === opponentDepth,
      ).length;
      const matchupHighestDepthWins = matchupResults.length - opponentWins;

      return {
        opponentDepth,
        gamesPlayed: matchupResults.length,
        higherDepthWins: matchupHighestDepthWins,
        opponentWins,
        matchScore: `${matchupHighestDepthWins}-${opponentWins}`,
      };
    });

  console.log(
    `\nHighest depth ${highestDepth} wins: ${highestDepthWins}/${highestDepthGames.length}`,
  );
  console.log(`Match scores for depth ${highestDepth}`);
  console.table(matchScores);
}

function runWorkerPool(
  jobs: TournamentJob[],
  workerCount: number,
  onResult: (result: TournamentGameResult) => Promise<void>,
) {
  return new Promise<void>((resolvePool, rejectPool) => {
    let nextJobIndex = 0;
    let completed = 0;
    let stopped = false;
    const workers = new Set<Worker>();

    const stopWithError = (error: Error) => {
      if (stopped) {
        return;
      }

      stopped = true;
      for (const worker of workers) {
        void worker.terminate();
      }
      rejectPool(error);
    };

    const assignNext = (worker: Worker) => {
      if (stopped) {
        return;
      }

      const job = jobs[nextJobIndex];
      nextJobIndex += 1;

      if (!job) {
        return;
      }

      worker.postMessage(job);
    };

    for (let index = 0; index < workerCount; index += 1) {
      const worker = new Worker(__filename, {
        workerData: null,
      } satisfies WorkerOptions);
      workers.add(worker);

      worker.on("message", (response: WorkerResponse) => {
        if (!response.ok) {
          stopWithError(
            new Error(
              `Tournament game ${response.jobId} failed: ${response.error}`,
            ),
          );
          return;
        }

        void onResult(response.result)
          .then(() => {
            completed += 1;

            if (completed === jobs.length) {
              stopped = true;
              for (const activeWorker of workers) {
                void activeWorker.terminate();
              }
              resolvePool();
              return;
            }

            assignNext(worker);
          })
          .catch((error: unknown) => {
            stopWithError(
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });
      worker.on("error", stopWithError);
      worker.on("exit", (code) => {
        workers.delete(worker);
        if (!stopped && code !== 0) {
          stopWithError(
            new Error(`Tournament worker exited with code ${code}`),
          );
        }
      });
      assignNext(worker);
    }
  });
}

async function main() {
  const outputPath = process.argv
    .slice(2)
    .find((argument) => argument !== "--");

  if (!outputPath) {
    throw new Error(
      "Usage: corepack pnpm cpu:tournament -- <timeline-output.json>",
    );
  }

  const jobs = createJobs();
  const workerCount = Math.min(
    jobs.length,
    Math.max(1, availableParallelism() - 4),
  );
  const results: TournamentGameResult[] = [];
  let outputWrite = Promise.resolve();

  console.log(
    `Running ${jobs.length} games with ${workerCount} workers; timelines: ${resolve(outputPath)}`,
  );
  await writeTournamentFile(outputPath, workerCount, results);
  await runWorkerPool(jobs, workerCount, async (result) => {
    results.push(result);
    printGameResult(result, results.length, jobs.length);
    outputWrite = outputWrite.then(() =>
      writeTournamentFile(outputPath, workerCount, results),
    );
    await outputWrite;
  });
  printHighestDepthSummary(results);
}

if (isMainThread) {
  if (require.main === module) {
    void main().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
} else {
  parentPort?.on("message", (job: TournamentJob) => {
    try {
      parentPort?.postMessage({
        ok: true,
        result: runGame(job),
      } satisfies WorkerSuccess);
    } catch (error) {
      parentPort?.postMessage({
        ok: false,
        jobId: job.id,
        error:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      } satisfies WorkerFailure);
    }
  });
}
