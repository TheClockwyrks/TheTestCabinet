import { Routes } from "react-router";
import { useGalleryData } from "../data/galleryContext";
import { aboutRoutes } from "./about/router";
import { accountRoutes } from "./account/router";
import { homeRoutes } from "./home/router";
import { modelsRoutes } from "./models/router";
import { runsRoutes } from "./runs/router";
import { settingsRoutes } from "./settings/router";
import { testCasesRoutes } from "./testcases/router";
import { otherRoutes } from "./other/router";

// Single place that assembles every page's routes. Each page subtree owns its
// own router.tsx; this just stitches them together under one <Routes>. The runs
// section gains its run-execution routes only where the host can execute runs.
export function AppRoutes() {
  const { canExecute, harnessAuth } = useGalleryData();
  return (
    <Routes>
      {homeRoutes()}
      {testCasesRoutes()}
      {modelsRoutes()}
      {runsRoutes(canExecute)}
      {otherRoutes(canExecute)}
      {aboutRoutes()}
      {settingsRoutes(canExecute, harnessAuth != null)}
      {accountRoutes(canExecute)}
    </Routes>
  );
}
