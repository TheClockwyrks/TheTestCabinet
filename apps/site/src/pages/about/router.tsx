import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { AboutPage } from "./AboutPage";

// Routes owned by the about page subtree.
export function aboutRoutes() {
  return <Route path={routePatterns.about} element={<AboutPage />} />;
}
