import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AppRoutes } from "./pages/router";
import { Backdrop } from "./components/Backdrop";
import { BackdropSettingsProvider } from "./components/backdrop/BackdropSettingsContext";
import "./styles/global.scss";

// GitHub Pages serves a single static bundle with no server-side routing, so a
// deep link such as /runs/<id> arrives as a 404. `public/404.html` stashes the
// requested path and redirects to the app root; restore it here, before the
// router mounts, so the deep link resolves client-side.
const spaPath = sessionStorage.getItem("spaPath");
if (spaPath) {
  sessionStorage.removeItem("spaPath");
  window.history.replaceState(null, "", spaPath);
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    {/* The sun toggle (in the topbar) and the backdrop scene share this state. */}
    <BackdropSettingsProvider>
      {/* Neon grid + scanline atmosphere, painted behind the routed page content. */}
      <Backdrop />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </BackdropSettingsProvider>
  </StrictMode>,
);
