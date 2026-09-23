import { render, screen, within } from "@testing-library/react";
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
// whole section absent where the fold isn't served (the static site). Below it,
// the List price and Billed rate sections: the curated figures a run's
// comparable cost is computed from beside the official endpoint's observed
// rate, with the difference between them surfaced per price class.

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
  listPrice: null,
  listPriceAsOf: null,
  priceHistory: [],
  contextLength: null,
  providerPin: null,
  providerPinSetByHand: false,
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
    expect(await screen.findByText("List price")).toBeTruthy();
    // …but no Accuracy section, and no fabricated empty rings.
    expect(screen.queryByText("Accuracy")).toBeNull();
  });
});

describe("the Stats tab's price sections", () => {
  function renderPriced(model: ModelSummary) {
    render(
      <MemoryRouter initialEntries={[`/models/${model.slug}/stats`]}>
        <GalleryDataProvider
          value={
            {
              ...galleryValue(),
              models: [model],
            } as unknown as GalleryDataInput
          }
        >
          <Routes>
            <Route path="/models/:modelId/stats" element={<ModelStatsPage />} />
          </Routes>
        </GalleryDataProvider>
      </MemoryRouter>,
    );
  }

  it("shows the list price and the billed rate side by side with the difference", async () => {
    renderPriced({
      ...MODEL,
      // The curated figures: $3 / $0.30 / $15 per Mtok, taken mid-August.
      listPrice: {
        uncachedInput: 3e-6,
        cachedInput: 3e-7,
        output: 15e-6,
      },
      listPriceAsOf: "2026-08-15",
      // The observed billed rate: input discounted 10%, output surcharged 10%,
      // the cached class unchanged.
      prices: {
        uncachedInput: 2.7e-6,
        cachedInput: 3e-7,
        output: 16.5e-6,
      },
    });

    // Both sections render, in the page's order.
    expect(await screen.findByText("List price")).toBeTruthy();
    expect(screen.getByText("Billed rate")).toBeTruthy();
    // The list figures per Mtok, and when they were taken.
    const listSection = screen.getByText("List price").closest("section")!;
    expect(within(listSection).getByText("$3.00")).toBeTruthy();
    expect(within(listSection).getByText("$0.30")).toBeTruthy();
    expect(within(listSection).getByText("$15.00")).toBeTruthy();
    expect(within(listSection).getByText("Aug 15, 2026")).toBeTruthy();
    // The billed figures per Mtok beside them.
    const billedSection = screen.getByText("Billed rate").closest("section")!;
    expect(within(billedSection).getByText("$2.70")).toBeTruthy();
    expect(within(billedSection).getByText("$16.50")).toBeTruthy();
    // The difference per class, signed against the list figure.
    expect(within(billedSection).getByText("−10.0% vs list")).toBeTruthy();
    expect(within(billedSection).getByText("+10.0% vs list")).toBeTruthy();
    expect(within(billedSection).getByText("+0.0% vs list")).toBeTruthy();
  });

  it("names the enqueue refusal when the model has no list price", async () => {
    renderPriced({
      ...MODEL,
      listPrice: null,
      listPriceAsOf: null,
      prices: { uncachedInput: 3e-6, cachedInput: null, output: 15e-6 },
    });

    expect(
      await screen.findByText(
        "No list price — runs of this model are refused at enqueue",
      ),
    ).toBeTruthy();
    // The billed rate still renders; with no list figure there is no
    // difference to report against it.
    expect(screen.getByText("Billed rate")).toBeTruthy();
    expect(screen.queryByText(/vs list/)).toBeNull();
  });

  it("says so when no billed rate has been observed yet", async () => {
    renderPriced({
      ...MODEL,
      listPrice: {
        uncachedInput: 3e-6,
        cachedInput: 3e-7,
        output: 15e-6,
      },
      listPriceAsOf: "2026-08-15",
      prices: null,
    });

    expect(await screen.findByText("No billed rate observed yet")).toBeTruthy();
    expect(screen.getByText("$3.00")).toBeTruthy();
  });
});
