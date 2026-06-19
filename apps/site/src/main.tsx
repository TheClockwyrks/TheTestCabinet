import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { GalleryApp, GalleryDataProvider } from "@test-cabinet/ui/app";
import { useStaticGallery } from "./staticGallery";

// The gallery ships as a single static bundle with no server-side routing, so a
// deep link such as /runs/<id> arrives as a 404. `public/404.html` stashes the
// requested path and redirects to the app root; restore it here, before the
// router mounts, so the deep link resolves client-side.
const spaPath = sessionStorage.getItem("spaPath");
if (spaPath) {
  sessionStorage.removeItem("spaPath");
  window.history.replaceState(null, "", spaPath);
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

// The static gallery: the shared app (from @test-cabinet/ui) rendered with the
// build-time snapshot as its data source. Its global styles come in as a side
// effect of importing the shared app entry.
function SiteApp() {
  const data = useStaticGallery();
  return (
    <GalleryDataProvider value={data}>
      <BrowserRouter>
        <GalleryApp />
      </BrowserRouter>
    </GalleryDataProvider>
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <SiteApp />
  </StrictMode>,
);
