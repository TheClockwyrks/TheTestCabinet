import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { RunDetailPage } from "./RunDetailPage";

// Routes owned by the run detail page subtree.
export function runRoutes() {
  return (
    <Route path={routePatterns.runDetail} element={<RunDetailPage />} />
  );
}
