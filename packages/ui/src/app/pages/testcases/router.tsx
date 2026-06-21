import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { TestCaseOverviewPage } from "./[slug]/TestCaseOverviewPage";
import { TestCaseInputsPage } from "./[slug]/TestCaseInputsPage";
import { TestCaseRunsPage } from "./[slug]/TestCaseRunsPage";
import { TestCaseLeaderboardPage } from "./[slug]/TestCaseLeaderboardPage";
import { TestCaseMetricsPage } from "./[slug]/TestCaseMetricsPage";
import { TestCaseArenaPage } from "./[slug]/TestCaseArenaPage";
import { TestCasesPage } from "./TestCasesPage";

// Routes owned by the test-cases section: the catalog list and the per-slug
// detail, whose Overview / Inputs / Runs / Leaderboard / Metrics tabs are each
// their own URL so a tab (and the selected variant, carried in the query string)
// is linkable.
// Returned as a fragment so the app's single <Routes> stitches every section's
// routes together.
export function testCasesRoutes() {
  return (
    <>
      <Route path={routePatterns.testCases} element={<TestCasesPage />} />
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
      {/* The arena is console-only; the page itself guards on the arena
          capability and renders a short note where it is absent. */}
      <Route
        path={routePatterns.testCaseArena}
        element={<TestCaseArenaPage />}
      />
    </>
  );
}
