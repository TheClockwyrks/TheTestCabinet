import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { AboutPage } from "./AboutPage";
import { AboutTestingPage } from "./AboutTestingPage";
import { AboutMetricsPage } from "./AboutMetricsPage";

// Routes owned by the about section: the top-level About copy plus the Testing
// and Metrics tabs, each its own URL so a tab is linkable. Returned as a
// fragment so the app's single <Routes> stitches every section's routes
// together.
export function aboutRoutes() {
  return (
    <>
      <Route path={routePatterns.about} element={<AboutPage />} />
      <Route path={routePatterns.aboutTesting} element={<AboutTestingPage />} />
      <Route path={routePatterns.aboutMetrics} element={<AboutMetricsPage />} />
    </>
  );
}
