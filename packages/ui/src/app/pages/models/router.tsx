import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { ModelOverviewPage } from "./[modelId]/ModelOverviewPage";
import { ModelRunsPage } from "./[modelId]/ModelRunsPage";
import { ModelStatsPage } from "./[modelId]/ModelStatsPage";
import { ModelConfigPage } from "./ModelConfigPage";
import { ModelsPage } from "./ModelsPage";

// Routes owned by the models section: the catalog list and the per-model detail,
// whose Overview / Stats / Runs tabs are each their own URL so a tab is linkable.
// Overview is the detail index — the per-test-case reading of how the model has
// done. The add/edit config form is one component covering both `/models/new` (a
// blank or run-seeded draft) and `/models/:modelId/edit`; it degrades to a
// sign-in notice where configuring models isn't possible, so it needs no route
// gate. `/models/new` is a static path, so it outranks the `/models/:modelId`
// dynamic route regardless of order. Returned as a fragment so the app's single
// <Routes> stitches every section's routes together.
export function modelsRoutes() {
  return (
    <>
      <Route path={routePatterns.models} element={<ModelsPage />} />
      <Route path={routePatterns.modelNew} element={<ModelConfigPage />} />
      <Route path={routePatterns.modelDetail} element={<ModelOverviewPage />} />
      <Route path={routePatterns.modelStats} element={<ModelStatsPage />} />
      <Route path={routePatterns.modelEdit} element={<ModelConfigPage />} />
      <Route path={routePatterns.modelRuns} element={<ModelRunsPage />} />
    </>
  );
}
