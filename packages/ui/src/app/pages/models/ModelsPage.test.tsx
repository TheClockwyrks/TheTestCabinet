import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import type { CatalogStatus } from "../../data/galleryContext";
import type { ModelSummary } from "../../data/models";
import { ModelsPage } from "./ModelsPage";

// The static gallery mounts no `BackendProvider`, so any hook that reaches for
// the backend must degrade gracefully rather than throw. `ModelsPage` calls
// `useModelConfig()` (to decide whether to show the "+ Add model" affordance);
// that hook once asserted the provider was present, crashing the whole page on
// the static site. These render exactly as the static site does — data provider
// + router, no backend/worker/auth providers.

const MODELS = [
  { slug: "anthropic-claude", name: "Claude", provider: "anthropic" },
] as unknown as ModelSummary[];

function galleryValue(
  models: ModelSummary[] = MODELS,
  modelsStatus: CatalogStatus = "ready",
): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models,
    modelsStatus,
    canExecute: false,
  } as unknown as GalleryDataInput;
}

function renderPage(
  tab?: "models" | "providers",
  value: GalleryDataInput = galleryValue(),
) {
  return render(
    <MemoryRouter
      initialEntries={[tab === "providers" ? "/models/providers" : "/models"]}
    >
      <GalleryDataProvider value={value}>
        <ModelsPage tab={tab} />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

describe("ModelsPage on the static site (no BackendProvider)", () => {
  it("renders the catalog without crashing", () => {
    expect(() => renderPage()).not.toThrow();
    expect(screen.getByText("Claude")).toBeTruthy();
  });

  it("hides the add-model affordance when configuration is unavailable", () => {
    renderPage();
    expect(screen.queryByText("+ Add model")).toBeNull();
  });

  it("renders the section tab strip with the catalog tab active", () => {
    renderPage();
    // Scoped to the section strip — the topbar carries its own "Models" link.
    const strip = screen.getByRole("navigation", { name: "Models sections" });
    const models = within(strip).getByRole("link", { name: "Models" });
    expect(models.getAttribute("aria-current")).toBe("page");
    expect(within(strip).getByRole("link", { name: "Providers" })).toBeTruthy();
  });

  it("shows the providers tab's unavailable state without a backend", () => {
    renderPage("providers");
    const strip = screen.getByRole("navigation", { name: "Models sections" });
    const providers = within(strip).getByRole("link", { name: "Providers" });
    expect(providers.getAttribute("aria-current")).toBe("page");
    // No aggregation endpoint on the static site: the tab says so rather than
    // rendering an empty chart.
    expect(screen.getByText(/need a connected backend/)).toBeTruthy();
  });
});

// The render-order rule, on the page the user reported. `useLiveGallery` keeps a
// loaded catalog when a refresh fails and only moves the status to `error`, and
// the refresh token is bumped by EVERY finished run — so a page that branches on
// the status before it looks at the rows blanks a working table on one network
// blip and throws away the catalog that was retained for it. Data first, read
// state second.
describe("ModelsPage's render order", () => {
  it("keeps the rows when a refresh over a loaded catalog fails", () => {
    renderPage("models", galleryValue(MODELS, "error"));
    // The retained catalog is on screen…
    expect(screen.getByText("Claude")).toBeTruthy();
    // …and the failure is reported over it as the stale data it is, never as an
    // unavailable catalog.
    expect(screen.getByRole("alert").textContent).toMatch(/out of date/i);
    expect(screen.queryByText(/catalog is unavailable/i)).toBeNull();
    expect(screen.queryByText(/No models are in the catalog yet/i)).toBeNull();
  });

  it("reports a failed read with nothing to show as unavailable", () => {
    renderPage("models", galleryValue([], "error"));
    expect(screen.getByText(/catalog is unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/No models are in the catalog yet/i)).toBeNull();
  });

  it("waits rather than claiming an empty catalog while the read is in flight", () => {
    renderPage("models", galleryValue([], "loading"));
    expect(screen.getByText(/Loading models/i)).toBeTruthy();
    expect(screen.queryByText(/No models are in the catalog yet/i)).toBeNull();
  });

  it("says the catalog is empty only once the read settled with nothing", () => {
    renderPage("models", galleryValue([], "ready"));
    expect(screen.getByText(/No models are in the catalog yet/i)).toBeTruthy();
  });
});
