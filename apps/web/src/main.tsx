import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// The shared app (imported via App) brings its own global styles and full
// synthwave theme as a side effect, so the web console matches the site exactly.
import { App } from "./app";
import { initTelemetry } from "./telemetry";

// Initialize browser telemetry first, before any fetch can fire, so the fetch
// instrumentation is installed up front. No-op unless the OTLP endpoint env var
// is set.
initTelemetry();

const rootElement = document.querySelector("#root");
if (!rootElement) {
  throw new Error("#root element not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
