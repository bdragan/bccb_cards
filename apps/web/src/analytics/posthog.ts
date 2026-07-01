import posthog from "posthog-js";

type AnalyticsProperties = Record<
  string,
  boolean | number | string | null | undefined
>;
type AnalyticsEventName = "first_hand_completed" | "game_completed";

let initialized = false;
let initialAcquisitionProperties: AnalyticsProperties | undefined;

const removableTrackingParams = [
  "fbclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
];

function analyticsEnabled() {
  return (
    Boolean(import.meta.env.VITE_POSTHOG_KEY) &&
    (import.meta.env.PROD || import.meta.env.VITE_POSTHOG_ENABLE_LOCAL === "true")
  );
}

function readAcquisitionProperties(): AnalyticsProperties {
  const params = new URLSearchParams(window.location.search);

  return {
    path: window.location.pathname,
    referrer: document.referrer || undefined,
    language: navigator.language,
    fbclid: params.get("fbclid") ?? undefined,
    utm_source: params.get("utm_source") ?? undefined,
    utm_medium: params.get("utm_medium") ?? undefined,
    utm_campaign: params.get("utm_campaign") ?? undefined,
    utm_content: params.get("utm_content") ?? undefined,
    utm_term: params.get("utm_term") ?? undefined,
    utm_id: params.get("utm_id") ?? undefined,
  };
}

function cleanupTrackingParams() {
  const url = new URL(window.location.href);
  let changed = false;

  for (const param of removableTrackingParams) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  window.history.replaceState(
    window.history.state,
    document.title,
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function initAnalytics() {
  if (initialized) {
    return;
  }

  initialAcquisitionProperties = readAcquisitionProperties();

  if (!analyticsEnabled()) {
    cleanupTrackingParams();
    return;
  }

  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host:
      import.meta.env.VITE_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    autocapture: false,
    capture_pageview: false,
    disable_session_recording: true,
  });

  initialized = true;
  cleanupTrackingParams();
}

export function trackEvent(
  eventName: AnalyticsEventName,
  properties: AnalyticsProperties = {},
) {
  if (!initialized) {
    return;
  }

  posthog.capture(eventName, {
    game: "belot",
    mode: "static_cpu",
    ...initialAcquisitionProperties,
    ...properties,
  });
}
