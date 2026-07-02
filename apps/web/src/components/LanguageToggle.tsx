import { getMessages, locales, useI18n } from "../i18n";

export function LanguageToggle() {
  const { locale, setLocale, messages } = useI18n();

  return (
    <div
      aria-label={messages.language}
      className="grid shrink-0 grid-cols-4 rounded-md bg-slate-100 p-1"
      role="group"
    >
      {locales.map((nextLocale) => (
        <button
          key={nextLocale}
          type="button"
          aria-label={messages.switchLanguage(
            getMessages(nextLocale).localeName,
          )}
          className={`rounded px-3 py-2 text-sm font-semibold ${
            locale === nextLocale ? "bg-white shadow" : ""
          }`}
          onClick={() => setLocale(nextLocale)}
        >
          {nextLocale.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
