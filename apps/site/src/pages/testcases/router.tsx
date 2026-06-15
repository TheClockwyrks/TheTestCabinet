import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { TestCaseDetailPage } from "./TestCaseDetailPage";
import { TestCasesPage } from "./TestCasesPage";

// Routes owned by the test-cases section: the catalog list and a per-slug
// detail page. Returned as a fragment so the app's single <Routes> stitches
// every section's routes together.
export function testCasesRoutes() {
  return (
    <>
      <Route path={routePatterns.testCases} element={<TestCasesPage />} />
      <Route
        path={routePatterns.testCaseDetail}
        element={<TestCaseDetailPage />}
      />
    </>
  );
}
