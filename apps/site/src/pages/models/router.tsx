import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { ModelAboutPage } from "./[modelId]/ModelAboutPage";
import { ModelRunsPage } from "./[modelId]/ModelRunsPage";
import { ModelStatsPage } from "./[modelId]/ModelStatsPage";
import { ModelsPage } from "./ModelsPage";

// Routes owned by the models section: the catalog list and the per-model detail,
// whose About / Stats / Runs tabs are each their own URL so a tab is linkable.
// Returned as a fragment so the app's single <Routes> stitches every section's
// routes together.
export function modelsRoutes() {
  return (
    <>
      <Route path={routePatterns.models} element={<ModelsPage />} />
      <Route path={routePatterns.modelDetail} element={<ModelAboutPage />} />
      <Route path={routePatterns.modelStats} element={<ModelStatsPage />} />
      <Route path={routePatterns.modelRuns} element={<ModelRunsPage />} />
    </>
  );
}
