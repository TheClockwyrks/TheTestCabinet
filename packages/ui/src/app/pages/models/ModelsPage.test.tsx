import { render, screen } from "@testing-library/react";
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

function renderPage() {
  return render(
    <MemoryRouter>
      <GalleryDataProvider value={galleryValue()}>
        <ModelsPage />
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
});
