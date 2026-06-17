import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaticCpuApp } from "../app/StaticCpuApp";
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
});
