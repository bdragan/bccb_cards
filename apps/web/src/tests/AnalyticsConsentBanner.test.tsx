import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsConsentBanner } from "../components/AnalyticsConsentBanner";
import { I18nProvider } from "../i18n";

vi.mock("../analytics/posthog", () => ({
  disableAnalytics: vi.fn(),
  initAnalytics: vi.fn(),
}));

const { disableAnalytics, initAnalytics } = await import("../analytics/posthog");

function renderBanner() {
  return render(
    <I18nProvider>
      <AnalyticsConsentBanner />
    </I18nProvider>,
  );
}

describe("AnalyticsConsentBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(disableAnalytics).mockClear();
    vi.mocked(initAnalytics).mockClear();
  });

  it("shows the analytics notice by default", () => {
    renderBanner();

    expect(
      screen.getByRole("dialog", { name: "Analytics and browser storage" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("starts analytics after consent", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(initAnalytics).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("card-games-analytics-consent-v1")).toBe(
      "accepted",
    );
    expect(
      screen.queryByRole("dialog", { name: "Analytics and browser storage" }),
    ).not.toBeInTheDocument();
  });

  it("dismisses without analytics when consent is declined", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(disableAnalytics).toHaveBeenCalledTimes(1);
    expect(initAnalytics).not.toHaveBeenCalled();
    expect(localStorage.getItem("card-games-analytics-consent-v1")).toBe(
      "rejected",
    );
    expect(
      screen.queryByRole("dialog", { name: "Analytics and browser storage" }),
    ).not.toBeInTheDocument();
  });

  it("does not show the notice again after consent was accepted", () => {
    localStorage.setItem("card-games-analytics-consent-v1", "accepted");

    renderBanner();

    expect(initAnalytics).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("dialog", { name: "Analytics and browser storage" }),
    ).not.toBeInTheDocument();
  });

  it("does not show the notice again after consent was rejected", () => {
    localStorage.setItem("card-games-analytics-consent-v1", "rejected");

    renderBanner();

    expect(initAnalytics).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "Analytics and browser storage" }),
    ).not.toBeInTheDocument();
  });
});
