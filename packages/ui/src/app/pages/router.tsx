import { Routes } from "react-router";
import { useGalleryData } from "../data/galleryContext";
import { aboutRoutes } from "./about/router";
import { homeRoutes } from "./home/router";
import { modelsRoutes } from "./models/router";
import { runsRoutes } from "./runs/router";
import { testCasesRoutes } from "./testcases/router";

// Single place that assembles every page's routes. Each page subtree owns its
// own router.tsx; this just stitches them together under one <Routes>. The runs
// section gains its run-execution routes only where the host can execute runs.
export function AppRoutes() {
  const { canExecute } = useGalleryData();
  return (
    <Routes>
      {homeRoutes()}
      {testCasesRoutes()}
      {modelsRoutes()}
      {runsRoutes(canExecute)}
      {aboutRoutes()}
    </Routes>
  );
}
