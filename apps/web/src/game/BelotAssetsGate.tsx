import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { useI18n } from "../i18n";
import { areBelotImagesLoaded, preloadBelotImages } from "./card-assets";

export function BelotAssetsGate({ children }: { children: ReactNode }) {
  const { messages } = useI18n();
  const [loaded, setLoaded] = useState(() => areBelotImagesLoaded());

  useEffect(() => {
    let active = true;

    void preloadBelotImages().then(() => {
      if (active) {
        setLoaded(true);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  if (!loaded) {
    return (
      <section className="rounded-md bg-white/10 p-6 text-center text-sm font-semibold text-white">
        {messages.loadingCards}
      </section>
    );
  }

  return <>{children}</>;
}
