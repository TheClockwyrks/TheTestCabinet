import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
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

function galleryValue(): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models: MODELS,
    modelsStatus: "ready",
    canExecute: false,
  } as unknown as GalleryDataInput;
}

function renderPage(tab?: "models" | "providers") {
  return render(
    <MemoryRouter
      initialEntries={[tab === "providers" ? "/models/providers" : "/models"]}
    >
      <GalleryDataProvider value={galleryValue()}>
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
