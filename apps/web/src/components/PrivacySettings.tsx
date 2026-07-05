import { useState } from "react";

import { applyAnalyticsConsent, readStoredConsent } from "../analytics/consent";
import { useI18n } from "../i18n";
import { Button } from "./Button";

type PrivacyChoice = "accepted" | "rejected";

export function PrivacySettings() {
  const { messages } = useI18n();
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState<PrivacyChoice | undefined>(() =>
    readStoredConsent(),
  );

  function chooseConsent(nextConsent: PrivacyChoice) {
    applyAnalyticsConsent(nextConsent);
    setConsent(nextConsent);
  }

  return (
    <section className="w-full">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-sm font-semibold text-ink transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-felt"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{messages.privacySettings}</span>
        <span
          className={`block h-2 w-2 shrink-0 border-b-2 border-r-2 border-current transition-transform ${
            open ? "-translate-y-px rotate-45" : "rotate-[315deg]"
          }`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="mt-2 rounded-md border border-slate-200 bg-white p-3">
          <h2 className="text-sm font-bold">{messages.analyticsConsentTitle}</h2>
          <p className="mt-1 text-sm leading-5 text-slate-700">
            {messages.analyticsConsentBody}
          </p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {consent === "accepted"
              ? messages.analyticsConsentAccepted
              : consent === "rejected"
                ? messages.analyticsConsentRejected
                : messages.analyticsConsentUnset}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              className="w-full px-3"
              variant={consent === "accepted" ? "selected" : "primary"}
              onClick={() => chooseConsent("accepted")}
            >
              {messages.analyticsConsentAllow}
            </Button>
            <Button
              type="button"
              className="w-full px-3"
              variant={consent === "rejected" ? "selected" : "primary"}
              onClick={() => chooseConsent("rejected")}
            >
              {messages.analyticsConsentDecline}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
