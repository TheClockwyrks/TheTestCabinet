import { Backdrop } from "./components/Backdrop";
import { ConfirmDialogProvider } from "./components/ConfirmDialog";
import { NotificationsLayer } from "./components/NotificationsLayer";
import { PageErrorBoundary } from "./components/PageErrorBoundary";
import { useGalleryData } from "./data/galleryContext";
import { AppRoutes } from "./pages/router";

// The shared, routed gallery UI — the whole site (Home / Test Cases / Runs /
// Models / About) plus, where the host enables it, the run-execution pages. Host
// apps mount this inside their own router and a `GalleryDataProvider` (and, for
// the web console, the backend/worker client providers). It owns the synthwave
// backdrop; the user's visual preferences (the sun, the event-feed style) live
// in the shared `appSettings` store, so no provider is needed here. The data and
// the run-execution capability come from context, so the static site and the
// web console render the same component. The console additionally wraps this in
// a <RunsRuntimeProvider> (above its data source) so launched runs are tracked;
// the static site needs none (its no-op default suffices).
export function GalleryApp() {
  // The run-execution console (web) gets the notification subsystem — the
  // toast layer, the slide-out sidebar, and the worker subscription. The static
  // site can't run or complete a run, so it never mounts it (and `useWorkers`,
  // which the layer reads, isn't provided there).
  const { canExecute } = useGalleryData();
  return (
    // Every page asks its destructive questions through the themed dialog rather
    // than the browser's own `confirm()`, so the provider wraps the whole routed
    // app — including the portalled run context menu, which raises one too.
    <ConfirmDialogProvider>
      {/* Neon grid + scanline atmosphere, painted behind the routed pages. */}
      <Backdrop />
      {/* Only the routed body is guarded, and deliberately so: a page that throws
          loses itself, not the chrome around it and not the notification layer
          above it, so there is still a nav to leave by. */}
      <PageErrorBoundary>
        <AppRoutes />
      </PageErrorBoundary>
      {canExecute && <NotificationsLayer />}
    </ConfirmDialogProvider>
  );
}
