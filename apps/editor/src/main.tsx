import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { EditorErrorBoundary } from "./components/editor-error-boundary";
import { guardedRouteChunk } from "./components/route-chunk-loader";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Editor root element is missing");
}

const EditorApp = lazy(
  guardedRouteChunk(() =>
    import("./app/App").then((module) => ({
      default: module.App,
    })),
  ),
);

// The desktop shell owns one surface: the editor. Every path opens it.
createRoot(container).render(
  <StrictMode>
    <EditorErrorBoundary>
      <Suspense
        fallback={<div className="editor-loading">Loading editor…</div>}
      >
        <EditorApp />
      </Suspense>
    </EditorErrorBoundary>
  </StrictMode>,
);

// The desktop shell serves the editor from its own bundled files, so there is
// no network to cache and no deploy to recover from; it never installs a
// service worker. Development builds still unregister one left behind by an
// earlier hosted build on the same origin.
if ("serviceWorker" in navigator && !import.meta.env.PROD) {
  void navigator.serviceWorker
    .getRegistrations()
    .then(async (registrations) => {
      if (registrations.length === 0) return;
      const wasControlled = navigator.serviceWorker.controller !== null;
      await Promise.all(
        registrations.map((registration) => registration.unregister()),
      );
      if (wasControlled) window.location.reload();
    });
}
