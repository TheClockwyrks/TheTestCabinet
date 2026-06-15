import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { ModelDetailPage } from "./ModelDetailPage";
import { ModelsPage } from "./ModelsPage";

// Routes owned by the models section: the catalog list and a per-model detail
// page. Returned as a fragment so the app's single <Routes> stitches every
// section's routes together.
export function modelsRoutes() {
  return (
    <>
      <Route path={routePatterns.models} element={<ModelsPage />} />
      <Route path={routePatterns.modelDetail} element={<ModelDetailPage />} />
    </>
  );
}
