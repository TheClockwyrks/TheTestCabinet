import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { HomePage } from "./HomePage";

// Routes owned by the home page subtree.
export function homeRoutes() {
  return <Route path={routePatterns.home} element={<HomePage />} />;
}
