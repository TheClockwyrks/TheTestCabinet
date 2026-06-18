import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The shared UI token contract (synthwave defaults); override in global.scss to
// re-theme the console.
import "@test-cabinet/ui/tokens.css";
import "./styles/global.scss";
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
