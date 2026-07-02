import {
  applyBelotAction,
  type BelotState,
  createBelotInitialState,
} from "@card-games/game-core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackEvent } from "../analytics/posthog";
import {
  StaticCpuApp,
  staticCpuFirstHandCompletedStorageKey,
  staticCpuStorageKey,
} from "../app/StaticCpuApp";
import { I18nProvider, setLocaleForTests } from "../i18n";
import { cpuLevelProgressStorageKey } from "../progress/cpu-levels";

vi.mock("../analytics/posthog", () => ({
  trackEvent: vi.fn(),
}));

const humanPlayerId = "offline-human";
const cpuPlayerId = "offline-cpu";
let testWorkers: TestWorker[] = [];

class TestWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    testWorkers.push(this);
  }
}

describe("StaticCpuApp", () => {
  beforeEach(() => {
    testWorkers = [];
    setLocaleForTests("en");
    vi.stubGlobal("Worker", TestWorker);
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    vi.mocked(trackEvent).mockClear();
  });

  afterEach(() => {
    localStorage.removeItem(staticCpuStorageKey);
    localStorage.removeItem(staticCpuFirstHandCompletedStorageKey);
    localStorage.removeItem(cpuLevelProgressStorageKey);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function dispatchBeforeUnload() {
    const event = new Event("beforeunload", { cancelable: true });

    return {
      allowed: window.dispatchEvent(event),
      defaultPrevented: event.defaultPrevented,
    };
  }

  function createStartedState() {
    let state = createBelotInitialState([
      { playerId: humanPlayerId, displayName: "Stored human" },
      { playerId: cpuPlayerId, displayName: "Stored CPU" },
    ]);
    state = applyBelotAction(state, {
      type: "set-ready",
      playerId: humanPlayerId,
      ready: true,
    });
    state = applyBelotAction(state, {
      type: "set-ready",
      playerId: cpuPlayerId,
      ready: true,
    });

    return state;
  }

  function createDeclarationState() {
    let state = createStartedState();
    state = applyBelotAction(state, {
      type: "trump-accept-upcard",
      playerId: state.trumpTurnPlayerId!,
    });

    return state;
  }

  function createHumanTurnTrickPlayState() {
    let state = createDeclarationState();
    state = applyBelotAction(state, {
      type: "declare",
      playerId: humanPlayerId,
      declarations: [],
    });
    state = applyBelotAction(state, {
      type: "declare",
      playerId: cpuPlayerId,
      declarations: [],
    });

    return {
      ...state,
      currentTurnPlayerId: humanPlayerId,
    };
  }

  function createCpuTurnTrickPlayState() {
    const state = createHumanTurnTrickPlayState();
    const humanCard = state.players.find(
      (player) => player.playerId === humanPlayerId,
    )?.hand[0];

    if (!humanCard) {
      throw new Error("Expected the human player to have a card");
    }

    return applyBelotAction(state, {
      type: "play-card",
      playerId: humanPlayerId,
      cardId: humanCard.id,
    });
  }

  function createHumanTurnAfterCompletedTrickState() {
    let state = createCpuTurnTrickPlayState();
    const cpuCard = state.players
      .find((player) => player.playerId === cpuPlayerId)
      ?.hand.find((card) => card.suit === state.currentTrick[0]?.card.suit);
    const fallbackCpuCard = state.players.find(
      (player) => player.playerId === cpuPlayerId,
    )?.hand[0];

    if (!cpuCard && !fallbackCpuCard) {
      throw new Error("Expected the CPU player to have a legal card");
    }

    state = applyBelotAction(state, {
      type: "play-card",
      playerId: cpuPlayerId,
      cardId: (cpuCard ?? fallbackCpuCard)!.id,
    });

    return {
      ...state,
      currentTurnPlayerId: humanPlayerId,
    };
  }

  function writeStoredGame(
    state: BelotState,
    overrides: Partial<{
      hasHumanProgress: boolean;
      trackedHandCount: number;
      gameCompletedTracked: boolean;
      playerProgressUpdated: boolean;
    }> = {},
  ) {
    localStorage.setItem(
      staticCpuStorageKey,
      JSON.stringify({
        version: 1,
        state,
        hasHumanProgress: true,
        gameStartedAt: Date.now(),
        trackedHandCount: 0,
        gameCompletedTracked: false,
        ...overrides,
      }),
    );
  }

  function storedCompletedHandState(phase: "hand-complete" | "finished") {
    const state = createStartedState();

    const result: NonNullable<BelotState["lastHandResult"]> = {
      dealerPlayerId: state.dealerPlayerId,
      callerPlayerId: humanPlayerId,
      opponentPlayerId: cpuPlayerId,
      trumpSuit: "hearts",
      gamePointsByPlayer: { [humanPlayerId]: 21, [cpuPlayerId]: 15 },
      declarationPointsByPlayer: { [humanPlayerId]: 0, [cpuPlayerId]: 0 },
      totalPointsByPlayer: { [humanPlayerId]: 21, [cpuPlayerId]: 15 },
      handScoreByPlayer: { [humanPlayerId]: 2, [cpuPlayerId]: 1 },
      schusterPlayerIds: [],
      callerFell: false,
      callerFellOnGame: false,
      isMus: false,
      lastTrickWinnerPlayerId: humanPlayerId,
    };

    return {
      ...state,
      phase,
      trumpSuit: "hearts",
      callerPlayerId: humanPlayerId,
      currentTurnPlayerId: undefined,
      trumpTurnPlayerId: undefined,
      currentTrick: [],
      completedTricks: [
        {
          winnerPlayerId: "offline-human",
          cards: [
            {
              playerId: humanPlayerId,
              card: { id: "A-hearts", rank: "A", suit: "hearts" },
            },
            {
              playerId: cpuPlayerId,
              card: { id: "K-hearts", rank: "K", suit: "hearts" },
            },
          ],
        },
      ],
      lastHandResult: result,
      handResults: [result],
      winnerPlayerId: phase === "finished" ? humanPlayerId : undefined,
      finishedAt: phase === "finished" ? new Date().toISOString() : undefined,
      players: state.players.map((player) => ({
        ...player,
        hand: [],
        hiddenCards: [],
        wonCards: [],
        totalScore: player.playerId === humanPlayerId ? 2 : 1,
      })),
    } satisfies BelotState;
  }

  it("renders the CPU-only game without backend controls", async () => {
    const user = userEvent.setup();

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    expect(await screen.findAllByText("Me")).not.toHaveLength(0);
    expect(screen.getAllByText("AI")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New game" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Play Bela vs CPU")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Login" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Room")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Menu" }));

    expect(
      screen.getByRole("button", { name: "Resign game" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch language to Srpski" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Login" }),
    ).not.toBeInTheDocument();
  });

  it("confirms resigning in the trick area and shows the CPU as winner there", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      cpuLevelProgressStorageKey,
      JSON.stringify({ level: "Silver", points: 3 }),
    );

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("button", { name: "Resign game" }));

    const currentTrick = screen.getByTestId("belot-current-trick");
    expect(within(currentTrick).getByText("Resign game?")).toBeInTheDocument();

    await user.click(within(currentTrick).getByRole("button", { name: "Yes" }));

    expect(
      await within(currentTrick).findByText("Winner: AI"),
    ).toBeInTheDocument();
    expect(
      within(currentTrick).getByRole("button", { name: "New game" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("belot-winner")).toHaveLength(1);

    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith(
        "game_completed",
        expect.objectContaining({
          hand_count: 0,
          player_current_rank: "Silver 3",
          player_current_rank_level: "Silver",
          player_current_rank_points: 3,
          winner: "cpu",
        }),
      );
    });
  });

  it("keeps the game active when resign confirmation is cancelled", async () => {
    const user = userEvent.setup();

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("button", { name: "Resign game" }));
    await user.click(
      within(screen.getByTestId("belot-current-trick")).getByRole("button", {
        name: "No",
      }),
    );

    expect(screen.queryByText("Winner: AI")).not.toBeInTheDocument();
    expect(screen.queryByText("Resign game?")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Pass" }),
    ).toBeInTheDocument();
  });

  it("does not confirm refreshes before the player acts", async () => {
    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    expect(await screen.findByRole("button", { name: "Pass" })).toBeEnabled();

    expect(dispatchBeforeUnload()).toEqual({
      allowed: true,
      defaultPrevented: false,
    });
  });

  it("does not confirm refreshes after the player acts", async () => {
    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Pass" }));

    expect(dispatchBeforeUnload()).toEqual({
      allowed: true,
      defaultPrevented: false,
    });
  });

  it("stores the static game after the player acts", async () => {
    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Pass" }));

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem(staticCpuStorageKey) ?? "null",
      ) as {
        hasHumanProgress?: boolean;
        state?: { trumpPasses?: string[] };
      };

      expect(stored.hasHumanProgress).toBe(true);
      expect(stored.state?.trumpPasses).toContain("offline-human");
    });
  });

  it("continues the stored static game on refresh", async () => {
    let state = createStartedState();
    state = applyBelotAction(state, {
      type: "trump-pass",
      playerId: humanPlayerId,
    });

    writeStoredGame(state);

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    expect(
      await screen.findByRole("progressbar", { name: "AI to play" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pass" }),
    ).not.toBeInTheDocument();
  });

  it("resumes declarations by submitting the human declaration once and scheduling the CPU", async () => {
    writeStoredGame(createDeclarationState());

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem(staticCpuStorageKey) ?? "null",
      ) as {
        state?: {
          phase?: string;
          declarationsByPlayer?: Record<string, unknown[]>;
        };
      };

      expect(stored.state?.phase).toBe("declarations");
      expect(
        Array.isArray(stored.state?.declarationsByPlayer?.[humanPlayerId]),
      ).toBe(true);
      expect(stored.state?.declarationsByPlayer?.[cpuPlayerId]).toBeUndefined();
    });

    await waitFor(() => {
      expect(testWorkers[0]?.postMessage).toHaveBeenCalledTimes(1);
    });

    const cpuRequest = testWorkers[0]?.postMessage.mock.calls[0]?.[0] as {
      state?: BelotState;
    };

    expect(cpuRequest.state?.phase).toBe("declarations");
    expect(
      Array.isArray(cpuRequest.state?.declarationsByPlayer[humanPlayerId]),
    ).toBe(true);
    expect(cpuRequest.state?.declarationsByPlayer[cpuPlayerId]).toBeUndefined();
  });

  it("resumes a human trick-play turn without replaying the previous completed trick", async () => {
    writeStoredGame(createHumanTurnAfterCompletedTrickState());

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("belot-hand-card").length).toBeGreaterThan(
        0,
      );
    });

    expect(
      document.querySelectorAll(
        '[data-testid="belot-hand-card"]:not([disabled])',
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("belot-current-trick")).toBeInTheDocument();
    expect(screen.queryByTestId("belot-current-trick-card")).toBeNull();
    expect(testWorkers[0]?.postMessage).not.toHaveBeenCalled();
  });

  it("resumes a CPU trick-play turn with exactly one worker request", () => {
    vi.useFakeTimers();

    try {
      writeStoredGame(createCpuTurnTrickPlayState());

      render(
        <I18nProvider>
          <StaticCpuApp />
        </I18nProvider>,
      );

      expect(testWorkers).toHaveLength(1);
      expect(testWorkers[0]?.postMessage).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(449);
      });

      expect(testWorkers[0]?.postMessage).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(testWorkers[0]?.postMessage).toHaveBeenCalledTimes(1);

      const cpuRequest = testWorkers[0]?.postMessage.mock.calls[0]?.[0] as {
        state?: BelotState;
      };

      expect(cpuRequest.state?.phase).toBe("trick-play");
      expect(cpuRequest.state?.currentTurnPlayerId).toBe(cpuPlayerId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts the next hand instead of showing a stored completed hand result", async () => {
    writeStoredGame(storedCompletedHandState("hand-complete"), {
      trackedHandCount: 1,
    });

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    expect(screen.queryByTestId("belot-hand-result")).not.toBeInTheDocument();
    expect(screen.queryByText("Next hand")).not.toBeInTheDocument();

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem(staticCpuStorageKey) ?? "null",
      ) as { state?: { phase?: string; lastHandResult?: unknown } };

      expect(stored.state?.phase).toBe("trump-round-one");
      expect(stored.state?.lastHandResult).toBeUndefined();
    });
  });

  it("tracks the first completed hand once and stores the local analytics guard", async () => {
    writeStoredGame(storedCompletedHandState("hand-complete"));

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith(
        "first_hand_completed",
        expect.objectContaining({
          caller: "human",
          hand_number: 1,
          hand_winner: "human",
          trump_suit: "hearts",
        }),
      );
    });
    expect(localStorage.getItem(staticCpuFirstHandCompletedStorageKey)).toBe(
      "true",
    );
  });

  it("does not track the first completed hand after the local analytics guard exists", async () => {
    localStorage.setItem(staticCpuFirstHandCompletedStorageKey, "true");
    writeStoredGame(storedCompletedHandState("hand-complete"));

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem(staticCpuStorageKey) ?? "null",
      ) as { state?: { phase?: string } };

      expect(stored.state?.phase).toBe("trump-round-one");
    });
    expect(trackEvent).not.toHaveBeenCalledWith(
      "first_hand_completed",
      expect.anything(),
    );
  });

  it("updates stored CPU level progress after a finished game", async () => {
    writeStoredGame(storedCompletedHandState("finished"), {
      trackedHandCount: 1,
      gameCompletedTracked: true,
      playerProgressUpdated: false,
    });

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    const rankButton = await screen.findByRole("button", {
      name: "Your current rank is: Bronze",
    });
    expect(rankButton).toHaveTextContent("Bronze");
    expect(screen.queryByTestId("belot-winner")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New game" }),
    ).not.toBeInTheDocument();

    await userEvent.click(rankButton);

    expect(
      within(screen.getByTestId("player-current-rank-popover")).getByText(
        "Your current rank is: Bronze",
      ),
    ).toBeInTheDocument();
    const rankPopover = within(
      screen.getByTestId("player-current-rank-popover"),
    );
    expect(
      rankPopover.getByText("There are the following ranks in Belot 1v1:"),
    ).toBeInTheDocument();
    expect(rankPopover.getAllByRole("listitem").map((item) => item.textContent))
      .toEqual([
        "Bronze",
        "Silver",
        "Gold",
        "Platinum",
        "Diamond",
        "Master",
        "Grandmaster",
      ]);
    expect(screen.getByTestId("player-current-rank-popover")).toHaveTextContent(
      "Rules of Belot 1v1.",
    );
    expect(rankPopover.getByRole("link", { name: "Rules" })).toHaveAttribute(
      "href",
      "/rules/belot-user-en.html",
    );

    await waitFor(() => {
      expect(
        JSON.parse(localStorage.getItem(cpuLevelProgressStorageKey) ?? "null"),
      ).toEqual({
        level: "Bronze",
        points: 2,
      });
    });

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem(staticCpuStorageKey) ?? "null",
      ) as { state?: { phase?: string; handResults?: unknown[] } };

      expect(stored.state?.phase).toBe("trump-round-one");
      expect(stored.state?.handResults).toEqual([]);
    });
  });

  it("does not update CPU level progress again when a stored finished game was already counted", async () => {
    localStorage.setItem(
      cpuLevelProgressStorageKey,
      JSON.stringify({ level: "Bronze", points: 2 }),
    );
    writeStoredGame(storedCompletedHandState("finished"), {
      trackedHandCount: 1,
      gameCompletedTracked: true,
      playerProgressUpdated: true,
    });

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    expect(
      await screen.findByRole("button", {
        name: "Your current rank is: Bronze",
      }),
    ).toHaveTextContent("Bronze");
    expect(screen.queryByTestId("belot-winner")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(
        JSON.parse(localStorage.getItem(cpuLevelProgressStorageKey) ?? "null"),
      ).toEqual({
        level: "Bronze",
        points: 2,
      });
    });
  });

  it("updates stored finished game progress only once under React StrictMode", async () => {
    writeStoredGame(storedCompletedHandState("finished"), {
      trackedHandCount: 1,
      gameCompletedTracked: true,
      playerProgressUpdated: false,
    });

    render(
      <StrictMode>
        <I18nProvider>
          <StaticCpuApp />
        </I18nProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(
        JSON.parse(localStorage.getItem(cpuLevelProgressStorageKey) ?? "null"),
      ).toEqual({
        level: "Bronze",
        points: 2,
      });
    });
    expect(screen.queryByTestId("belot-winner")).not.toBeInTheDocument();
  });

  it.each([
    ["invalid JSON", "{"],
    [
      "wrong storage version",
      JSON.stringify({
        version: 2,
        state: {
          gameId: "belot",
          phase: "trump-round-one",
          players: [],
        },
        hasHumanProgress: true,
        gameStartedAt: Date.now(),
        trackedHandCount: 0,
        gameCompletedTracked: false,
      }),
    ],
    [
      "incomplete stored Belot state",
      JSON.stringify({
        version: 1,
        state: {
          gameId: "belot",
          phase: "hand-complete",
          players: [],
          currentTrick: [],
          completedTricks: [],
          declarationsByPlayer: {},
          publicCardsByPlayer: {},
        },
        hasHumanProgress: true,
        gameStartedAt: Date.now(),
        trackedHandCount: 1,
        gameCompletedTracked: false,
      }),
    ],
  ])("falls back to a new game when storage contains %s", async (_, value) => {
    localStorage.setItem(staticCpuStorageKey, value);

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    expect(await screen.findByRole("button", { name: "Pass" })).toBeEnabled();

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem(staticCpuStorageKey) ?? "null",
      ) as { state?: { phase?: string }; hasHumanProgress?: boolean };

      expect(stored.hasHumanProgress).toBe(false);
      expect(stored.state?.phase).toBe("trump-round-one");
    });
  });
});
