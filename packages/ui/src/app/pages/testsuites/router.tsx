import { Route } from "react-router";

import { routePatterns } from "../../routes";
import { SuiteAssetsPage } from "./[slug]/suite-assets-page";
import { SuiteChangelogPage } from "./[slug]/suite-changelog-page";
import { SuiteDefinitionsPage } from "./[slug]/suite-definitions-page";
import { SuiteDemonstrationsPage } from "./[slug]/suite-demonstrations-page";
import { SuiteOverviewPage } from "./[slug]/suite-overview-page";
import { SuiteReferencesPage } from "./[slug]/suite-references-page";
import { SuiteSpecificationsPage } from "./[slug]/suite-specifications-page";

// One suite's detail surfaces: the landing tab rendered from its showcase, and a
// read-only view per group of entities the anchored version holds. Each tab is
// its own route under `/test-cases/suites/:suiteSlug`, so a tab is linkable and
// the anchored version rides the query string across all of them.
//
// Mounted beside the Test Suites listing and on the same condition — whether the
// host's transport exposes the suite reads at all — so no host is offered a page
// it cannot fill. Returned as a fragment for the same reason every section's
// routes are: the app stitches them into one `<Routes>`.
export function testSuiteRoutes() {
  return (
    <>
      <Route
        path={routePatterns.testSuiteDetail}
        element={<SuiteOverviewPage />}
      />
      <Route
        path={routePatterns.testSuiteSpecifications}
        element={<SuiteSpecificationsPage />}
      />
      <Route
        path={routePatterns.testSuiteDefinitions}
        element={<SuiteDefinitionsPage />}
      />
      <Route
        path={routePatterns.testSuiteAssets}
        element={<SuiteAssetsPage />}
      />
      <Route
        path={routePatterns.testSuiteDemos}
        element={<SuiteDemonstrationsPage />}
      />
      <Route
        path={routePatterns.testSuiteReferences}
        element={<SuiteReferencesPage />}
      />
      <Route
        path={routePatterns.testSuiteChangelog}
        element={<SuiteChangelogPage />}
      />
    </>
  );
}
