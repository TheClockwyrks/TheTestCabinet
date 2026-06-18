import { Backdrop } from "./components/Backdrop";
import { AppRoutes } from "./pages/router";

// The shared, routed gallery UI — the whole site (Home / Test Cases / Runs /
// Models / About) plus, where the host enables it, the run-execution pages. Host
// apps mount this inside their own router and a `GalleryDataProvider` (and, for
// the consoles, the backend/worker client providers). It owns the synthwave
// backdrop; the user's visual preferences (the sun, the event-feed style) live
// in the shared `appSettings` store, so no provider is needed here. The data and
// the run-execution capability come from context, so the static site and the
// consoles render the same component. A console host additionally wraps this in
// a <RunsRuntimeProvider> (above its data source) so launched runs are tracked;
// the static site needs none (its no-op default suffices).
export function GalleryApp() {
  return (
    <>
      {/* Neon grid + scanline atmosphere, painted behind the routed pages. */}
      <Backdrop />
      <AppRoutes />
    </>
  );
}
