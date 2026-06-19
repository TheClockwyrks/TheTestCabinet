import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Initialize browser telemetry first, before any fetch can fire, so the
// fetch instrumentation is installed up front. No-op unless the OTLP endpoint
// env var is set.
import { initTelemetry } from "./telemetry";
// The shared app (imported via App) brings its own global styles and full
// synthwave theme as a side effect, so the web console matches the site exactly.
import { App } from "./App";

initTelemetry();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
