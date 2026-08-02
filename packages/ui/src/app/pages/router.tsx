import { Routes } from "react-router";
import { useGalleryData } from "../data/galleryContext";
import { aboutRoutes } from "./about/router";
import { accountRoutes } from "./account/router";
import { homeRoutes } from "./home/router";
import { modelsRoutes } from "./models/router";
import { ggAnalysisRoutes } from "./gg/router";
import { runsRoutes } from "./runs/router";
import { settingsRoutes } from "./settings/router";
import { testCasesRoutes } from "./testcases/router";
import { otherRoutes } from "./other/router";

// Single place that assembles every page's routes. Each page subtree owns its
// own router.tsx; this just stitches them together under one <Routes>. The runs
// section gains its run-execution routes only where the host can execute runs; the gg
// analysis section mounts on a console **or** on a host carrying a shipped gg corpus
// (the static site), in the reduced shape its own router describes.
export function AppRoutes() {
  const { canExecute, harnessAuth, ggData } = useGalleryData();
  return (
    <Routes>
      {homeRoutes()}
      {testCasesRoutes()}
      {modelsRoutes()}
      {runsRoutes(canExecute)}
      {ggAnalysisRoutes(canExecute, ggData != null)}
      {otherRoutes(canExecute)}
      {aboutRoutes()}
      {settingsRoutes(canExecute, harnessAuth != null)}
      {accountRoutes(canExecute)}
    </Routes>
  );
}
