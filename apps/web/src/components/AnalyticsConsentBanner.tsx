import { useState } from "react";

import { initAnalytics } from "../analytics/posthog";
import { useI18n } from "../i18n";
import { Button } from "./Button";

const analyticsConsentStorageKey = "card-games-analytics-consent-v1";

type AnalyticsConsent = "accepted" | "rejected";

function readStoredConsent(): AnalyticsConsent | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }

  const stored = localStorage.getItem(analyticsConsentStorageKey);

  return stored === "accepted" || stored === "rejected" ? stored : undefined;
}

function storeConsent(consent: AnalyticsConsent) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(analyticsConsentStorageKey, consent);
  }
}

export function AnalyticsConsentBanner() {
  const { messages } = useI18n();
  const [visible, setVisible] = useState(() => {
    const storedConsent = readStoredConsent();

    if (storedConsent === "accepted") {
      initAnalytics();
      return false;
    }

    return storedConsent !== "rejected";
  });

  if (!visible) {
    return null;
  }

  return (
    <section
      aria-labelledby="analytics-consent-title"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-emerald-100/50 bg-[#f6fbf8] px-4 py-3 text-ink shadow-[0_-16px_40px_rgb(24_33_47_/_20%)]"
      role="dialog"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="max-w-3xl">
          <h2
            className="text-base font-bold leading-6"
            id="analytics-consent-title"
          >
            {messages.analyticsConsentTitle}
          </h2>
          <p className="mt-1 text-sm leading-5 text-slate-700">
            {messages.analyticsConsentBody}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row md:flex-none">
          <Button
            className="w-full sm:w-auto"
            type="button"
            variant="primary"
            onClick={() => {
              storeConsent("rejected");
              setVisible(false);
            }}
          >
            {messages.analyticsConsentDecline}
          </Button>
          <Button
            className="w-full sm:w-auto"
            type="button"
            variant="selected"
            onClick={() => {
              storeConsent("accepted");
              initAnalytics();
              setVisible(false);
            }}
          >
            {messages.analyticsConsentAllow}
          </Button>
        </div>
      </div>
    </section>
  );
}
