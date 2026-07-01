import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../app/App";
import { I18nProvider, setLocaleForTests } from "../i18n";
import { useAuthStore } from "../stores/auth-store";

class TestWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage = vi.fn();
  terminate = vi.fn();
}

function renderApp() {
  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

describe("App", () => {
  beforeEach(() => {
    localStorage.removeItem("card-games-token");
    setLocaleForTests("en");
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
    const user = userEvent.setup();
    renderApp();

    expect(await screen.findAllByText("Me")).not.toHaveLength(0);
    expect(screen.getAllByText("AI")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Login" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Menu" }));

    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
    await user.click(document.body);
    expect(
      screen.queryByRole("button", { name: "Login" }),
    ).not.toBeInTheDocument();
    expect(document.title).toBe("Belot 1v1");
  });

  it("opens login and registration from anonymous play", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(
      screen.getByRole("button", { name: "Register" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("uses the Serbian anonymous player name", async () => {
    setLocaleForTests("sr");

    renderApp();

    expect(await screen.findAllByText("Ja")).not.toHaveLength(0);
    expect(document.title).toBe("Bela 1v1");
  });
});
