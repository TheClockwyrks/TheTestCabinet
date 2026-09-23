import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../../client/context";
import type { ModelAccuracy } from "../../../../client/types";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../../data/galleryContext";
import type { ModelSummary } from "../../../data/models";
import { ModelStatsPage } from "./ModelStatsPage";

// The Stats tab's Accuracy section: the model's gg turn/call outcomes per
// execution mode, summed across its covered ids, with absent halves presented
// as absent (an empty ring naming the mode) rather than as zeros — and the
// whole section absent where the fold isn't served (the static site).

// The page's app chrome reads contexts (backdrop settings, topbar) that are
// irrelevant to the stats under test.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const authState = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("../../../../client/auth", () => ({
  useAuth: () => ({ token: authState.token }),
}));

beforeEach(() => {
  authState.token = null;
});

const MODEL = {
  slug: "claude-x",
  name: "Claude X",
  provider: "Anthropic",
  isConfigured: true,
  openrouterUrl: null,
  description: null,
  logoSvg: null,
  // Two covered ids, so the fold across ids is exercised.
  modelIds: ["anthropic/claude-x", "anthropic/claude-x-preview"],
  aliases: [],
  prices: null,
  priceHistory: [],
  contextLength: null,
  providerSlug: null,
  releasedAt: null,
  inputModalities: [],
} as unknown as ModelSummary;

const ACCURACY: ModelAccuracy = {
  models: [
    {
      modelId: "anthropic/claude-x",
      rac: {
        runs: 3,
        turns: 30,
        valid: 22,
        compile: 4,
        runtime: 2,
        modelErrors: 1,
        missing: 1,
        byType: { transpile_compile: 4 },
        approximateRuns: 1,
      },
      toolCalling: {
        runs: 2,
        calls: 50,
        ok: 46,
        failures: { "invalid-argument": 4 },
        runsWithoutCallTotals: 1,
      },
    },
    {
      modelId: "anthropic/claude-x-preview",
      rac: {
        runs: 1,
        turns: 10,
        valid: 8,
        compile: 1,
        runtime: 1,
        modelErrors: 0,
        missing: 0,
        byType: { transpile_compile: 1 },
        approximateRuns: 0,
      },
      toolCalling: null,
    },
    {
      // A different model entirely — must not fold in.
      modelId: "mistral/other",
      rac: {
        runs: 9,
        turns: 900,
        valid: 900,
        compile: 0,
        runtime: 0,
        modelErrors: 0,
        missing: 0,
        byType: {},
        approximateRuns: 0,
      },
      toolCalling: null,
    },
  ],
  unattributableRuns: 2,
};

function galleryValue(): GalleryDataInput {
  return {
    models: [MODEL],
    modelsStatus: "ready",
    canExecute: true,
    queryRunSummaries: () => Promise.resolve({ summaries: [], total: 0 }),
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

function renderStats(client: object | null) {
  const page = (
    <Routes>
      <Route path="/models/:modelId/stats" element={<ModelStatsPage />} />
    </Routes>
  );
  render(
    <MemoryRouter initialEntries={["/models/claude-x/stats"]}>
      <GalleryDataProvider value={galleryValue()}>
        {client ? (
          <BackendProvider value={backendValue(client)}>{page}</BackendProvider>
        ) : (
          page
        )}
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

describe("the Stats tab's Accuracy section", () => {
  it("charts both halves summed across the model's covered ids", async () => {
    renderStats({ getModelAccuracy: vi.fn().mockResolvedValue(ACCURACY) });

    expect(await screen.findByText("Accuracy")).toBeTruthy();
    expect(screen.getByText("Responses as code")).toBeTruthy();
    expect(screen.getByText("Tool calling")).toBeTruthy();
    // The RaC ring's center total: 30 + 10 turns across the two covered ids —
    // the unrelated model's 900 turns stay out.
    expect(screen.getByText("40")).toBeTruthy();
    expect(screen.getByText("50")).toBeTruthy();
    // Legend entries for present classes; the summed valid count reads green.
    expect(screen.getByText("Valid")).toBeTruthy();
    expect(screen.getByText("Compile errors")).toBeTruthy();
    expect(screen.getByText("invalid-argument")).toBeTruthy();
    // The data-honesty notes: runs folded, and how many predate the counters.
    expect(
      screen.getByText(/4 runs · 1 predate exact turn accounting/),
    ).toBeTruthy();
    expect(screen.getByText(/2 runs · 1 predate call totals/)).toBeTruthy();
  });

  it("presents an absent half as absent, not zero", async () => {
    const only = {
      models: [ACCURACY.models[1]],
      unattributableRuns: 0,
    };
    renderStats({ getModelAccuracy: vi.fn().mockResolvedValue(only) });

    expect(await screen.findByText("Accuracy")).toBeTruthy();
    expect(
      screen.getByText(
        "No tool-calling gg runs with recorded call totals for this model.",
      ),
    ).toBeTruthy();
  });

  it("omits the section entirely where the fold isn't served", async () => {
    renderStats(null);
    // The rest of the tab still renders…
    expect(await screen.findByText("Pricing")).toBeTruthy();
    // …but no Accuracy section, and no fabricated empty rings.
    expect(screen.queryByText("Accuracy")).toBeNull();
  });
});
