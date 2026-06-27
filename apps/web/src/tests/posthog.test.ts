import posthog from "posthog-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: {
    capture: vi.fn(),
    init: vi.fn(),
  },
}));

describe("posthog analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_POSTHOG_ENABLE_LOCAL", "true");
    vi.stubEnv("VITE_POSTHOG_KEY", "test-key");
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(posthog.capture).mockClear();
    vi.mocked(posthog.init).mockClear();
  });

  it("removes tracking params from the visible URL after init", async () => {
    window.history.replaceState(
      null,
      "",
      "/?fbclid=facebook-click&utm_source=facebook&utm_medium=paid#game",
    );

    const { initAnalytics } = await import("../analytics/posthog");

    initAnalytics();

    expect(window.location.href).toBe("http://localhost:3000/#game");
    expect(posthog.init).toHaveBeenCalledTimes(1);
  });

  it("keeps initial attribution properties after cleaning the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/?fbclid=facebook-click&utm_id=ad-set&utm_campaign=launch",
    );

    const { initAnalytics, trackEvent } = await import("../analytics/posthog");

    initAnalytics();
    trackEvent("game_loaded");

    expect(posthog.capture).toHaveBeenCalledWith(
      "game_loaded",
      expect.objectContaining({
        fbclid: "facebook-click",
        game: "belot",
        mode: "static_cpu",
        path: "/",
        utm_campaign: "launch",
        utm_id: "ad-set",
      }),
    );
    expect(window.location.search).toBe("");
  });
});
