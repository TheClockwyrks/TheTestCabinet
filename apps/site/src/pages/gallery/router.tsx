import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { GalleryPage } from "./GalleryPage";

// Routes owned by the gallery page subtree.
export function galleryRoutes() {
  return (
    <Route path={routePatterns.galleryIndex} element={<GalleryPage />} />
  );
}
