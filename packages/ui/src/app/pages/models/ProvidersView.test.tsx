import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import type { ProviderStats } from "../../../client/types";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import type { ModelSummary } from "../../data/models";
import { ModelsPage } from "./ModelsPage";

// The Providers tab: per-provider run evidence with per-model rows, probe
// evidence clearly separated from it, and honest absence — the tab must say
// when the corpus carries no provider attribution rather than fabricate zeros.

// The page's app chrome reads contexts (backdrop settings, topbar) that are
// irrelevant to the surface under test.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const MODEL = {
  slug: "claude-x",
  name: "Claude X",
  provider: "Anthropic",
  logoSvg: null,
  modelIds: ["anthropic/claude-x"],
} as unknown as ModelSummary;

const STATS: ProviderStats = {
  runsScanned: 12,
  runsWithProviderData: 3,
  providers: [
    {
      provider: "DeepInfra",
      models: [
        {
          modelId: "anthropic/claude-x",
          stats: {
            runs: 2,
            calls: 40,
            totalTokens: 120000,
            cost: 1.25,
            rejected: 1,
            turns: 38,
            working: 30,
            errors: { sandbox_trap: 3, transpile_compile: 5 },
          },
        },
        {
          modelId: "mistral/uncurated",
          stats: {
            runs: 1,
            calls: 5,
            totalTokens: 9000,
            cost: null,
            rejected: 0,
            turns: 5,
            working: 5,
            errors: {},
          },
        },
      ],
      totals: {
        runs: 3,
        calls: 45,
        totalTokens: 129000,
        cost: 1.25,
        rejected: 1,
        turns: 43,
        working: 35,
        errors: { sandbox_trap: 3, transpile_compile: 5 },
      },
    },
    {
      provider: null,
      models: [
        {
          modelId: "anthropic/claude-x",
          stats: {
            runs: 1,
            calls: 0,
            totalTokens: 0,
            cost: null,
            rejected: 0,
            turns: 2,
            working: 0,
            errors: { model_timeout: 2 },
          },
        },
      ],
      totals: {
        runs: 1,
        calls: 0,
        totalTokens: 0,
        cost: null,
        rejected: 0,
        turns: 2,
        working: 0,
        errors: { model_timeout: 2 },
      },
    },
  ],
  probes: [
    {
      provider: "DeepInfra",
      models: [{ modelSlug: "claude-x", items: 12, passes: 9, errored: 2 }],
    },
  ],
};

const EMPTY: ProviderStats = {
  runsScanned: 12,
  runsWithProviderData: 0,
  providers: [],
  probes: [],
};

function galleryValue(
  catalog: { models?: ModelSummary[]; status?: string } = {},
): GalleryDataInput {
  return {
    models: catalog.models ?? [MODEL],
    modelsStatus: catalog.status ?? "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

function backendValue(client: object): BackendContextValue {
  return {
    client,
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

function renderProviders(
  client: object,
  catalog: { models?: ModelSummary[]; status?: string } = {},
) {
  render(
    <MemoryRouter initialEntries={["/models/providers"]}>
      <GalleryDataProvider value={galleryValue(catalog)}>
        <BackendProvider value={backendValue(client)}>
          <ModelsPage tab="providers" />
        </BackendProvider>
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

describe("the Providers tab", () => {
  it("renders run evidence per provider with probe evidence separated", async () => {
    renderProviders({ getProviderStats: vi.fn().mockResolvedValue(STATS) });

    // Run evidence: the provider block, with the catalog name resolved for a
    // covered id and the raw id kept for an uncurated one.
    expect(await screen.findByText("Run evidence")).toBeTruthy();
    expect(screen.getAllByText("DeepInfra").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Claude X").length).toBe(2);
    expect(screen.getByText("mistral/uncurated")).toBeTruthy();
    expect(screen.getByText("Unattributed")).toBeTruthy();
    // The error breakdown reads whole, by type.
    expect(
      screen.getByText("sandbox_trap ×3, transpile_compile ×5"),
    ).toBeTruthy();
    expect(screen.getByText("model_timeout ×2")).toBeTruthy();

    // Probe evidence: its own labeled section, clean rate over judged calls
    // only (9 clean of 12 − 2 errored).
    expect(screen.getByText("Probe evidence")).toBeTruthy();
    const probeTables = screen.getAllByRole("table");
    const probeTable = probeTables[probeTables.length - 1]!;
    expect(within(probeTable).getByText("claude-x")).toBeTruthy();
    expect(within(probeTable).getByText("90%")).toBeTruthy();
  });

  it("shows the unavailable notice when the transport has no endpoint", () => {
    renderProviders({});
    expect(screen.getByText(/need a connected backend/)).toBeTruthy();
  });

  it("says when the corpus carries no provider attribution", async () => {
    renderProviders({ getProviderStats: vi.fn().mockResolvedValue(EMPTY) });
    expect(await screen.findByText(/No provider data yet/)).toBeTruthy();
  });

  // This view names models, and an empty catalog is what a catalog still in
  // flight looks like — so without waiting on it the table rendered every model
  // by its raw id: a page that looks finished and is quietly wrong.
  it("waits on the model catalog too, rather than naming models by their ids", () => {
    renderProviders(
      { getProviderStats: vi.fn().mockResolvedValue(STATS) },
      { models: [], status: "loading" },
    );
    expect(screen.queryByText("anthropic/claude-x")).toBeNull();
    expect(screen.getByText("Loading provider statistics…")).toBeTruthy();
  });

  // A catalog that could not be read is said out loud, rather than left looking
  // like a cabinet that curates none of these models.
  it("says the model names are missing when the catalog read failed", async () => {
    renderProviders(
      { getProviderStats: vi.fn().mockResolvedValue(STATS) },
      { models: [], status: "error" },
    );
    expect(
      await screen.findByText(/model catalog could not be read/),
    ).toBeTruthy();
    // With no catalog the ids stand in for the names, which is exactly what the
    // notice above is there to explain.
    expect(screen.getAllByText("anthropic/claude-x").length).toBeGreaterThan(0);
  });

  it("surfaces a failed load as an error, not an empty corpus", async () => {
    renderProviders({
      getProviderStats: vi.fn().mockRejectedValue(new Error("backend down")),
    });
    expect(
      await screen.findByText(
        /Couldn't load provider statistics\. backend down/,
      ),
    ).toBeTruthy();
  });
});
