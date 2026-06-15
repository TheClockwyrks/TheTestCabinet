import { Routes } from "react-router";
import { aboutRoutes } from "./about/router";
import { homeRoutes } from "./home/router";
import { modelsRoutes } from "./models/router";
import { runRoutes } from "./run/router";
import { testCasesRoutes } from "./testcases/router";

// Single place that assembles every page's routes. Each page subtree owns its
// own router.tsx; this just stitches them together under one <Routes>.
export function AppRoutes() {
  return (
    <Routes>
      {homeRoutes()}
      {testCasesRoutes()}
      {modelsRoutes()}
      {runRoutes()}
      {aboutRoutes()}
    </Routes>
  );
}
