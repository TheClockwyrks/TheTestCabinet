import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { GalleryApp, GalleryDataProvider } from "@test-cabinet/ui/app";
import { useStaticGallery } from "./staticGallery";

// A deep link such as /runs/<id> arrives at its own URL: `public/_redirects`
// rewrites unmatched paths to the app shell with a 200, so the router reads the
// real location and nothing has to be restored here before it mounts.
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
