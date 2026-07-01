import {
  applyBelotAction,
  createBelotInitialState,
} from "@card-games/game-core";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaticCpuApp, staticCpuStorageKey } from "../app/StaticCpuApp";
import { I18nProvider, setLocaleForTests } from "../i18n";
import { cpuLevelProgressStorageKey } from "../progress/cpu-levels";

class TestWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage = vi.fn();
  terminate = vi.fn();
}

describe("StaticCpuApp", () => {
  beforeEach(() => {
    setLocaleForTests("en");
    vi.stubGlobal("Worker", TestWorker);
    vi.spyOn(Math, "random").mockReturnValue(0.75);
  });

  afterEach(() => {
    localStorage.removeItem(staticCpuStorageKey);
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
    expect(
      screen.getAllByTestId("belot-winner"),
    ).toHaveLength(1);
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
    expect(
      screen.queryByText("Resign game?"),
    ).not.toBeInTheDocument();
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
    let state = createBelotInitialState([
      { playerId: "offline-human", displayName: "Stored human" },
      { playerId: "offline-cpu", displayName: "Stored CPU" },
    ]);
    state = applyBelotAction(state, {
      type: "set-ready",
      playerId: "offline-human",
      ready: true,
    });
    state = applyBelotAction(state, {
      type: "set-ready",
      playerId: "offline-cpu",
      ready: true,
    });
    state = applyBelotAction(state, {
      type: "trump-pass",
      playerId: "offline-human",
    });

    localStorage.setItem(
      staticCpuStorageKey,
      JSON.stringify({
        version: 1,
        state,
        hasHumanProgress: true,
        gameStartedAt: Date.now(),
        trackedHandCount: 0,
        firstCardPlayTracked: false,
        gameCompletedTracked: false,
      }),
    );

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

  it("updates stored CPU level progress after a finished game", async () => {
    let state = createBelotInitialState([
      { playerId: "offline-human", displayName: "Stored human" },
      { playerId: "offline-cpu", displayName: "Stored CPU" },
    ]);
    state = applyBelotAction(state, {
      type: "set-ready",
      playerId: "offline-human",
      ready: true,
    });
    state = applyBelotAction(state, {
      type: "set-ready",
      playerId: "offline-cpu",
      ready: true,
    });
    state = {
      ...state,
      phase: "finished",
      winnerPlayerId: "offline-human",
      finishedAt: new Date().toISOString(),
      currentTurnPlayerId: undefined,
      trumpTurnPlayerId: undefined,
    };

    localStorage.setItem(
      staticCpuStorageKey,
      JSON.stringify({
        version: 1,
        state,
        hasHumanProgress: true,
        gameStartedAt: Date.now(),
        trackedHandCount: 0,
        firstCardPlayTracked: false,
        gameCompletedTracked: true,
        playerProgressUpdated: false,
      }),
    );

    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    expect(await screen.findByText("Silver 1")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        JSON.parse(
          localStorage.getItem(cpuLevelProgressStorageKey) ?? "null",
        ),
      ).toEqual({
        level: "Silver",
        points: 1,
      });
    });
  });
});
