import { Routes } from "react-router";
import { galleryRoutes } from "./gallery/router";
import { runRoutes } from "./run/router";

// Single place that assembles every page's routes. Each page subtree owns its
// own router.tsx; this just stitches them together under one <Routes>.
export function AppRoutes() {
  return (
    <Routes>
      {galleryRoutes()}
      {runRoutes()}
    </Routes>
  );
}
