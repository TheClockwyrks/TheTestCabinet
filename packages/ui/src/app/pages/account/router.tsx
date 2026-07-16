import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { AccountPage } from "./AccountPage";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";
import { CoveragePlansPage } from "./CoveragePlansPage";
import { CoveragePlanPage } from "./CoveragePlanPage";
import { CoveragePlanEditPage } from "./CoveragePlanEditPage";
import { GroupsPage } from "./GroupsPage";
import { GroupEditPage } from "./GroupEditPage";

// Routes owned by the account section: the signed-in account view (its Profile,
// Coverage, and Groups tabs) plus the sign-in and registration pages, each its own
// URL so it is linkable (the top-bar account control links to them). The reviewer
// coverage tooling — multiple coverage plans and the reusable groups they
// reference — lives here too, scoped to the account it belongs to. They drive the
// auth context the static site does not provide, so they mount only when the host
// can execute runs (the web + desktop consoles). Static segments like
// `/account/coverage/new` outrank the dynamic `:planId`, so route order does not
// matter. Returned as a fragment so the app's single <Routes> stitches every
// section's routes together.
export function accountRoutes(canExecute: boolean) {
  return (
    <>
      {canExecute && (
        <>
          <Route path={routePatterns.account} element={<AccountPage />} />
          <Route path={routePatterns.login} element={<LoginPage />} />
          <Route path={routePatterns.register} element={<RegisterPage />} />
          <Route
            path={routePatterns.accountCoverage}
            element={<CoveragePlansPage />}
          />
          <Route
            path={routePatterns.accountCoveragePlanNew}
            element={<CoveragePlanEditPage />}
          />
          <Route
            path={routePatterns.accountCoveragePlanEdit}
            element={<CoveragePlanEditPage />}
          />
          <Route
            path={routePatterns.accountCoveragePlan}
            element={<CoveragePlanPage />}
          />
          <Route
            path={routePatterns.accountGroups}
            element={<GroupsPage />}
          />
          <Route
            path={routePatterns.accountGroupNew}
            element={<GroupEditPage />}
          />
          <Route
            path={routePatterns.accountGroupEdit}
            element={<GroupEditPage />}
          />
        </>
      )}
    </>
  );
}
