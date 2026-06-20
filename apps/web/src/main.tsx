import "./app/styles.css";

import React from "react";
import ReactDOM from "react-dom/client";

import { initAnalytics } from "./analytics/posthog";
import { isStaticCpuOnlyBuild } from "./app/build-mode";
import { preloadBelotImages } from "./game/card-assets";
import { I18nProvider } from "./i18n";

async function bootstrap() {
  initAnalytics();
  void preloadBelotImages();

  const { App } = isStaticCpuOnlyBuild
    ? { App: (await import("./app/StaticCpuApp")).StaticCpuApp }
    : { App: (await import("./app/FullApp")).FullApp };

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
