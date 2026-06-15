import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AppRoutes } from "./pages/router";
import { DesignVariantProvider } from "./design/DesignVariantProvider";
import { DesignBackground } from "./design/DesignBackground";
import { DesignSwitcher } from "./design/DesignSwitcher";
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
    <DesignVariantProvider>
      {/* Per-variant atmosphere, painted behind the routed page content. */}
      <DesignBackground />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      {/* Floating design-direction switcher; sits above the page. */}
      <DesignSwitcher />
    </DesignVariantProvider>
  </StrictMode>,
);
