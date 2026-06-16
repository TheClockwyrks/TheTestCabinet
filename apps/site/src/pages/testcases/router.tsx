import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { TestCaseOverviewPage } from "./[slug]/TestCaseOverviewPage";
import { TestCaseSpecsPage } from "./[slug]/TestCaseSpecsPage";
import { TestCaseRunsPage } from "./[slug]/TestCaseRunsPage";
import { TestCasesPage } from "./TestCasesPage";

// Routes owned by the test-cases section: the catalog list and the per-slug
// detail, whose Overview / Specifications / Runs tabs are each their own URL so
// a tab (and the selected variant, carried in the query string) is linkable.
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
        path={routePatterns.testCaseSpecs}
        element={<TestCaseSpecsPage />}
      />
      <Route path={routePatterns.testCaseRuns} element={<TestCaseRunsPage />} />
    </>
  );
}
