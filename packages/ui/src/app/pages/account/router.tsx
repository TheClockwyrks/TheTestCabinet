import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { AccountPage } from "./AccountPage";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";

// Routes owned by the account section: the signed-in account view plus the
// sign-in and registration pages, each its own URL so it is linkable (the top-bar
// account control links to them). They drive the auth context the static site
// does not provide, so they mount only when the host can execute runs (the web +
// desktop consoles). Returned as a fragment so the app's single <Routes> stitches
// every section's routes together.
export function accountRoutes(canExecute: boolean) {
  return (
    <>
      {canExecute && (
        <>
          <Route path={routePatterns.account} element={<AccountPage />} />
          <Route path={routePatterns.login} element={<LoginPage />} />
          <Route path={routePatterns.register} element={<RegisterPage />} />
        </>
      )}
    </>
  );
}
