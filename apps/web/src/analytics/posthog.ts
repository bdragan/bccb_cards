import posthog from "posthog-js";

type AnalyticsProperties = Record<
  string,
  boolean | number | string | null | undefined
>;

let initialized = false;

function analyticsEnabled() {
  return (
    Boolean(import.meta.env.VITE_POSTHOG_KEY) &&
    (import.meta.env.PROD || import.meta.env.VITE_POSTHOG_ENABLE_LOCAL === "true")
  );
}

function acquisitionProperties(): AnalyticsProperties {
  const params = new URLSearchParams(window.location.search);

  return {
    path: window.location.pathname,
    referrer: document.referrer || undefined,
    language: navigator.language,
    utm_source: params.get("utm_source") ?? undefined,
    utm_medium: params.get("utm_medium") ?? undefined,
    utm_campaign: params.get("utm_campaign") ?? undefined,
    utm_content: params.get("utm_content") ?? undefined,
    utm_term: params.get("utm_term") ?? undefined,
  };
}

export function initAnalytics() {
  if (!analyticsEnabled() || initialized) {
    return;
  }

  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host:
      import.meta.env.VITE_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    autocapture: false,
    capture_pageview: true,
    disable_session_recording: true,
  });

  initialized = true;
}

export function trackEvent(
  eventName: string,
  properties: AnalyticsProperties = {},
) {
  if (!initialized) {
    return;
  }

  posthog.capture(eventName, {
    game: "belot",
    mode: "static_cpu",
    ...acquisitionProperties(),
    ...properties,
  });
}
