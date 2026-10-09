import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { CatalogStatus } from "../../data/galleryContext";
import type { ModelSummary } from "../../data/models";
import { ModelDetailLayout } from "./ModelDetailLayout";

// The layout's chrome reaches for the app-wide backdrop and the model-config
// capability; neither says anything about how an unresolved model is reported.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../data/useModelConfig", () => ({ useModelConfig: () => null }));

// The catalog the layout resolves against, swapped per test. Hoisted because a
// `vi.mock` factory is lifted above module scope.
const catalog = vi.hoisted(() => ({
  models: [] as unknown[],
  status: "ready" as string,
  refreshing: false,
}));
vi.mock("../../data/useModels", () => ({
  useModels: () => ({
    models: catalog.models,
    status: catalog.status,
    refreshing: catalog.refreshing,
  }),
}));

function summary(slug: string): ModelSummary {
  return {
    slug,
    name: slug.toUpperCase(),
    provider: "anthropic",
    modelIds: [slug],
    isConfigured: true,
    logoSvg: null,
    openrouterUrl: null,
  } as unknown as ModelSummary;
}

function renderFor(
  modelId: string,
  models: ModelSummary[],
  status: CatalogStatus,
  refreshing = false,
) {
  catalog.models = models;
  catalog.status = status;
  catalog.refreshing = refreshing;
  render(
    <MemoryRouter initialEntries={[`/models/${modelId}`]}>
      <Routes>
        <Route
          path="/models/:modelId"
          element={
            <ModelDetailLayout tab="overview">
              {({ model }) => <p>body for {model.slug}</p>}
            </ModelDetailLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

// The user's report, exactly: "if data is loading, the page must NEVER claim that
// the entity is not found. It MUST display a loading spinner and only ever
// display 'not found' if the entity is actually not found." A catalog read that
// FAILED is the same claim made on even less evidence.
describe("ModelDetailLayout when the model does not resolve", () => {
  it("shows the loading state while the catalog is in flight", () => {
    renderFor("claude", [], "loading");
    expect(screen.getByText("Loading model…")).toBeInTheDocument();
    expect(screen.queryByText(/Unknown model/)).toBeNull();
  });

  it("reports a failed catalog read as a failure, not as an unknown model", () => {
    renderFor("claude", [], "error");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Could not load the model catalog");
    expect(screen.queryByText(/Unknown model/)).toBeNull();
  });

  it("names the model as unknown only once the catalog has settled", () => {
    renderFor("claude", [summary("gpt")], "ready");
    expect(screen.getByText("Unknown model: claude")).toBeInTheDocument();
  });

  // The catalog the console kept through a failed refresh still resolves every
  // model it holds — the failure never blanks a page that was rendering fine.
  it("renders a model the kept catalog holds even after a failed refresh", () => {
    renderFor("claude", [summary("claude")], "error");
    expect(screen.getByText("body for claude")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// A refresh re-reads the catalog in place: the status stays `ready` and the
// models already loaded stay on screen. The config form saves a new model,
// requests that refresh and navigates here in one step, so this page's first
// render is against a catalog that predates the model it was opened on.
describe("ModelDetailLayout while the catalog is being refreshed", () => {
  it("shows loading, not unknown, while a refresh is in flight for a model not yet in the catalog", () => {
    renderFor("claude", [summary("gpt")], "ready", true);
    expect(screen.getByText("Loading model…")).toBeInTheDocument();
    expect(screen.queryByText(/Unknown model/)).not.toBeInTheDocument();
  });

  it("still renders a resolved model while refreshing", () => {
    renderFor("claude", [summary("claude")], "ready", true);
    expect(screen.getByText("body for claude")).toBeInTheDocument();
    expect(screen.queryByText("Loading model…")).not.toBeInTheDocument();
  });

  it("names the model unknown once the refresh has settled without it", () => {
    renderFor("claude", [summary("gpt")], "ready", false);
    expect(screen.getByText("Unknown model: claude")).toBeInTheDocument();
    expect(screen.queryByText("Loading model…")).not.toBeInTheDocument();
  });

  // A refresh that failed has settled too, and with the model still absent the
  // page reports the failure rather than waiting forever.
  it("reports the failure once a refresh has failed without the model", () => {
    renderFor("claude", [summary("gpt")], "error", false);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Loading model…")).not.toBeInTheDocument();
  });
});
