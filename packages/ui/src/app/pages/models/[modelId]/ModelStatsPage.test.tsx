import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../../client/context";
import type { ModelAccuracy, ModelCandidates } from "../../../../client/types";
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
  providerPin: null,
  providerPinSetByHand: false,
  nativeQuantization: null,
  maxInputPrice: null,
  maxOutputPrice: null,
  bannedProviders: [],
  unknownQuantizationProviders: [],
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

const CANDIDATES: ModelCandidates = {
  modelId: "anthropic/claude-x",
  nativeQuantization: "fp8",
  candidates: [
    {
      provider: "Anthropic",
      quantization: "fp8",
      developer: true,
      inputPrice: 3,
      outputPrice: 15,
      cacheReadPrice: 0.3,
      faultRate: 0.012,
    },
    {
      provider: "Bedrock",
      quantization: "fp8",
      developer: false,
      inputPrice: 2.5,
      outputPrice: 12,
      cacheReadPrice: 0.25,
      faultRate: null,
    },
  ],
  refusal: null,
};

describe("the Stats tab's Provider candidates section", () => {
  it("lists the candidates in order, marking the developer's endpoint", async () => {
    authState.token = "t";
    const getModelCandidates = vi.fn().mockResolvedValue(CANDIDATES);
    renderStats({ getModelCandidates });

    expect(await screen.findByText("Bedrock")).toBeTruthy();
    expect(getModelCandidates).toHaveBeenCalledWith("claude-x", "t");
    const rows = screen.getAllByRole("row");
    // The header, then the developer first.
    expect(rows[1]!.textContent).toContain("Anthropic");
    expect(rows[1]!.textContent).toContain("developer");
    expect(rows[1]!.textContent).toContain("$3.00");
    expect(rows[1]!.textContent).toContain("1.2%");
    expect(rows[2]!.textContent).not.toContain("developer");
    expect(rows[2]!.textContent).toContain("—");
    // The list assumes an agent that sets no reasoning, and says so.
    expect(screen.getByText(/sets no reasoning/)).toBeTruthy();
    expect(screen.getByText(/Native quantization fp8/)).toBeTruthy();
  });

  it("names the filter that emptied the list", async () => {
    authState.token = "t";
    renderStats({
      getModelCandidates: vi.fn().mockResolvedValue({
        ...CANDIDATES,
        candidates: [],
        refusal: "every endpoint left is on its catalog entry's ban list",
      }),
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "every endpoint left is on its catalog entry's ban list",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("asks a signed-out viewer to sign in rather than reading", async () => {
    const getModelCandidates = vi.fn();
    renderStats({ getModelCandidates });

    expect(await screen.findByText("Provider candidates")).toBeTruthy();
    expect(screen.getByText(/Sign in to see the providers/)).toBeTruthy();
    expect(getModelCandidates).not.toHaveBeenCalled();
  });

  it("is absent where the read isn't served", async () => {
    renderStats(null);
    expect(await screen.findByText("Pricing")).toBeTruthy();
    expect(screen.queryByText("Provider candidates")).toBeNull();
  });
});
