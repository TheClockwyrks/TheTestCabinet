import { Backdrop } from "./components/Backdrop";
import { BackdropSettingsProvider } from "./components/backdrop/BackdropSettingsContext";
import { AppRoutes } from "./pages/router";

// The shared, routed gallery UI — the whole site (Home / Test Cases / Runs /
// Models / About) plus, where the host enables it, the run-execution pages. Host
// apps mount this inside their own router and a `GalleryDataProvider` (and, for
// the consoles, the backend/worker client providers). It owns the synthwave
// backdrop and the sun-toggle state it shares with the topbar; the data and the
// run-execution capability come from context, so the static site and the
// consoles render the same component. A console host additionally wraps this in
// a <RunsRuntimeProvider> (above its data source) so launched runs are tracked;
// the static site needs none (its no-op default suffices).
export function GalleryApp() {
  return (
    <BackdropSettingsProvider>
      {/* Neon grid + scanline atmosphere, painted behind the routed pages. */}
      <Backdrop />
      <AppRoutes />
    </BackdropSettingsProvider>
  );
}
