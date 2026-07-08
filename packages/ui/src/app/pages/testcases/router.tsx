import { Navigate, Route } from "react-router";
import { routePatterns, routes } from "../../routes";
import { TestCaseOverviewPage } from "./[slug]/TestCaseOverviewPage";
import { TestCaseInputsPage } from "./[slug]/TestCaseInputsPage";
import { TestCaseRunsPage } from "./[slug]/TestCaseRunsPage";
import { TestCaseLeaderboardPage } from "./[slug]/TestCaseLeaderboardPage";
import { TestCaseMetricsPage } from "./[slug]/TestCaseMetricsPage";
import { TestCaseChangelogPage } from "./[slug]/TestCaseChangelogPage";
import { TestCaseArenaPage } from "./[slug]/TestCaseArenaPage";
import { TestCasesPage } from "./TestCasesPage";

// Routes owned by the test-cases section: the catalog list — one route per type
// tab (E2E / 2D / 3D / Particle / Audio / Adversarial / Performance) so the
// selected tab is in the URL and survives a reload, with the bare `/test-cases`
// redirecting to the default tab — and the per-slug detail, whose Overview / Inputs / Runs /
// Leaderboard / Metrics tabs are each their own URL so a tab (and the selected
// variant, carried in the query string) is linkable.
// Returned as a fragment so the app's single <Routes> stitches every section's
// routes together.
export function testCasesRoutes() {
  return (
    <>
      <Route
        path={routePatterns.testCases}
        element={
          <Navigate to={routes.testCasesCatalog("end-to-end")} replace />
        }
      />
      <Route
        path={routePatterns.testCasesE2E}
        element={<TestCasesPage tab="end-to-end" />}
      />
      <Route
        path={routePatterns.testCases2D}
        element={<TestCasesPage tab="2d" />}
      />
      <Route
        path={routePatterns.testCases3D}
        element={<TestCasesPage tab="3d" />}
      />
      <Route
        path={routePatterns.testCasesBlender}
        element={<TestCasesPage tab="blender" />}
      />
      <Route
        path={routePatterns.testCasesParticle}
        element={<TestCasesPage tab="particle" />}
      />
      <Route
        path={routePatterns.testCasesAudio}
        element={<TestCasesPage tab="audio" />}
      />
      <Route
        path={routePatterns.testCasesAdversarial}
        element={<TestCasesPage tab="adversarial" />}
      />
      <Route
        path={routePatterns.testCasesPerformance}
        element={<TestCasesPage tab="performance" />}
      />
      <Route
        path={routePatterns.testCaseDetail}
        element={<TestCaseOverviewPage />}
      />
      <Route
        path={routePatterns.testCaseInputs}
        element={<TestCaseInputsPage />}
      />
      <Route path={routePatterns.testCaseRuns} element={<TestCaseRunsPage />} />
      <Route
        path={routePatterns.testCaseLeaderboard}
        element={<TestCaseLeaderboardPage />}
      />
      <Route
        path={routePatterns.testCaseMetrics}
        element={<TestCaseMetricsPage />}
      />
      <Route
        path={routePatterns.testCaseChangelog}
        element={<TestCaseChangelogPage />}
      />
      {/* The arena is console-only; the page itself guards on the arena
          capability and renders a short note where it is absent. */}
      <Route
        path={routePatterns.testCaseArena}
        element={<TestCaseArenaPage />}
      />
    </>
  );
}
