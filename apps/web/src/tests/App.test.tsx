import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../app/App";
import { setLocaleForTests } from "../i18n";
import { useAuthStore } from "../stores/auth-store";

class TestWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage = vi.fn();
  terminate = vi.fn();
}

describe("App", () => {
  beforeEach(() => {
    localStorage.removeItem("card-games-token");
    useAuthStore.setState({
      token: undefined,
      user: undefined,
      loading: false,
      error: undefined,
    });
    vi.stubGlobal("Worker", TestWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts an anonymous CPU game on the home page", async () => {
    render(<App />);

    expect(await screen.findAllByText("Me")).not.toHaveLength(0);
    expect(screen.getAllByText("CPU")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
  });

  it("opens login and registration from anonymous play", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Login" }));

    expect(
      screen.getByRole("button", { name: "Register" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("uses the Serbian anonymous player name", async () => {
    setLocaleForTests("sr");

    render(<App />);

    expect(await screen.findAllByText("Ja")).not.toHaveLength(0);
  });
});
