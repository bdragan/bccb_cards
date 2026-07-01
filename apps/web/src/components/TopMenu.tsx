import type { PropsWithChildren } from "react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../i18n";

export function TopMenu({
  title,
  subtitle,
  children,
}: PropsWithChildren<{ title?: string; subtitle?: string }>) {
  const { messages } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[3px] z-30">
      <div className="mx-auto flex max-w-6xl justify-center px-4">
        <div ref={containerRef} className="relative w-[clamp(5.25rem,24vw,9rem)]">
        <button
          type="button"
          aria-expanded={open}
          aria-label={messages.menu}
          className="pointer-events-auto grid h-[18px] w-full place-items-center rounded-full border border-emerald-200/45 bg-felt/95 text-emerald-50 shadow-sm shadow-ink/20 transition hover:border-emerald-100 hover:bg-[#17613f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-100"
          onClick={() => setOpen((current) => !current)}
        >
          <span
            className={`block h-2 w-2 border-b-2 border-r-2 border-current transition-transform ${
              open ? "translate-y-px rotate-[225deg]" : "-translate-y-px rotate-45"
            }`}
            aria-hidden="true"
          />
          <span className="sr-only">
            {open ? messages.hideDetails : messages.showDetails}
          </span>
        </button>

        {open ? (
          <div className="pointer-events-auto absolute left-1/2 top-full mt-2 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-emerald-200/50 bg-[#f6fbf8] p-3 text-ink shadow-lg shadow-ink/20">
            {title || subtitle ? (
              <div className="mb-3 min-w-0 border-b border-slate-200 pb-3">
                {title ? (
                  <h1 className="truncate text-lg font-bold">{title}</h1>
                ) : null}
                {subtitle ? (
                  <p className="mt-0.5 truncate text-sm text-slate-600">
                    {subtitle}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-3">
              {children}
            </div>
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}
