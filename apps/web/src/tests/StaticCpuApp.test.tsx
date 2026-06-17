import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  shouldConfirmStaticCpuLeave,
  StaticCpuApp,
} from "../app/StaticCpuApp";
import { I18nProvider } from "../i18n";

class TestWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage = vi.fn();
  terminate = vi.fn();
}

describe("StaticCpuApp", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", TestWorker);
    vi.spyOn(Math, "random").mockReturnValue(0.75);
  });

  afterEach(() => {
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
    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    expect(await screen.findAllByText("Me")).not.toHaveLength(0);
    expect(screen.getAllByText("AI")).not.toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "New game" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Play Bela vs CPU")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Login" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Room")).not.toBeInTheDocument();
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

  it("confirms refreshes after the player acts", async () => {
    render(
      <I18nProvider>
        <StaticCpuApp />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Pass" }));

    expect(dispatchBeforeUnload()).toEqual({
      allowed: false,
      defaultPrevented: true,
    });
  });

  it("does not confirm refreshes after the game is finished", () => {
    expect(
      shouldConfirmStaticCpuLeave(true, { winnerPlayerId: "offline-human" }),
    ).toBe(false);
  });
});
