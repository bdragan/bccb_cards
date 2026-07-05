import { disableAnalytics, initAnalytics } from "./posthog";

export const analyticsConsentStorageKey = "card-games-analytics-consent-v1";

export type AnalyticsConsent = "accepted" | "rejected";

export function readStoredConsent(): AnalyticsConsent | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }

  const stored = localStorage.getItem(analyticsConsentStorageKey);

  return stored === "accepted" || stored === "rejected" ? stored : undefined;
}

export function applyAnalyticsConsent(consent: AnalyticsConsent) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(analyticsConsentStorageKey, consent);
  }

  if (consent === "accepted") {
    initAnalytics();
  } else {
    disableAnalytics();
  }
}
