import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The shared app (imported via App) brings its own global styles and full
// synthwave theme as a side effect, so the web console matches the site exactly.
import { App } from "./App";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
