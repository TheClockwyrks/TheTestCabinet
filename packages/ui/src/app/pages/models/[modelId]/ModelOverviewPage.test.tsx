import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { describe, expect, it } from "vitest";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../../data/galleryContext";
import type { ModelSummary } from "../../../data/models";
import { runSummaryPage, type RunQuery } from "../../../data/runQuery";
import { routePatterns, routes } from "../../../routes";
import { ModelOverviewPage } from "./ModelOverviewPage";

// The Overview tab reports one test case at a time and places the model against
// the other models that ran the same cohort. These render it exactly as the
// static site does — gallery data provider + router, no backend/worker/auth — and
// answer `queryRunSummaries` with the same pure page function the static site
// uses, so the fixtures exercise the real model- and case-scoped drains.

const MODELS = [
  {
    slug: "claude",
    name: "Claude",
    provider: "anthropic",
    modelIds: ["anthropic/claude"],
    isConfigured: true,
    openrouterUrl: null,
    description: null,
    logoSvg: null,
  },
] as unknown as ModelSummary[];

function run(overrides: {
  id: string;
  modelId?: string;
  testCaseSlug?: string;
  caseName?: string;
  version?: string;
  variant?: string;
  state?: string;
  cost?: number | null;
  tokens?: number;
}): RunSummary {
  const {
    id,
    modelId = "anthropic/claude",
    testCaseSlug = "carom",
    caseName = "Carom",
    version = "1.0.0",
    variant = "base",
    state = "completed",
    cost = 1,
    tokens = 1000,
  } = overrides;
  return {
    id,
    publishedAt: "2026-01-02T00:00:00Z",
    startedAt: `2026-01-01T00:00:0${id.length}Z`,
    finishedAt: "2026-01-01T00:10:00Z",
    caseName,
    subject: {
      testCaseSlug,
      testCaseVersion: version,
      testType: "end-to-end",
      variant,
      harnessSlug: "claude",
      harnessVersion: "1",
      modelId,
    },
    metrics: {
      runTimeSeconds: 600,
      tokens: {
        uncachedInput: tokens,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: { comparable: cost, actual: cost },
    },
    validationLoaded: true,
    state,
    rating: "great",
    reviewCount: 1,
    score: { earned: 8, total: 10, reviews: 1 },
    links: { sourceRepo: null, playableBuild: null },
  } as unknown as RunSummary;
}

// Claude runs carom twice on `base` (mean cost $5) and once on `hard-mode`, plus
// one run of another case; two rival models sit below it on carom/base.
const RUNS: RunSummary[] = [
  run({ id: "a", cost: 4 }),
  run({ id: "bb", cost: 6 }),
  run({ id: "ccc", variant: "hard-mode", cost: 3 }),
  run({
    id: "dddd",
    testCaseSlug: "space-invaders",
    caseName: "Space Invaders",
    cost: 2,
  }),
  run({ id: "eeeee", modelId: "openai/gpt", cost: 1 }),
  run({ id: "ffffff", modelId: "google/gemini", cost: 2 }),
];

function galleryValue(summaries: RunSummary[]): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async (query: RunQuery) => runSummaryPage(summaries, query),
    testCases: [],
    testCasesStatus: "ready",
    models: MODELS,
    modelsStatus: "ready",
    canExecute: false,
  } as unknown as GalleryDataInput;
}

function renderPage(summaries: RunSummary[] = RUNS) {
  return render(
    <MemoryRouter initialEntries={[routes.modelDetail("claude")]}>
      <GalleryDataProvider value={galleryValue(summaries)}>
        <Routes>
          <Route
            path={routePatterns.modelDetail}
            element={<ModelOverviewPage />}
          />
        </Routes>
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

describe("ModelOverviewPage", () => {
  it("opens on the model's most-run case and variant", async () => {
    renderPage();

    // Carom (3 runs) outranks Space Invaders (1), and `base` (2) outranks
    // `hard-mode` (1) within it.
    expect(await screen.findByText("Carom · Base")).toBeTruthy();
    const cases = screen.getByLabelText("Test case") as HTMLSelectElement;
    expect(cases.value).toBe("carom");
    expect(
      [...cases.options].map((option) => option.textContent),
    ).toEqual(["Carom (3 runs)", "Space Invaders (1 run)"]);
  });

  it("aggregates only the selected cohort, never across cases", async () => {
    renderPage();
    await screen.findByText("Carom · Base");

    // Two of Claude's six runs are carom/base; the $2 space-invaders run and the
    // $3 hard-mode run must not move the mean.
    expect(labelledValue("Carom · Base", "Runs")).toBe("2");
    expect(labelledValue("Carom · Base", "Mean cost")).toBe("$5.00");
    expect(labelledValue("Carom · Base", "Completed")).toBe("100%");
    expect(labelledValue("Carom · Base", "Mean score")).toBe("80%");
  });

  it("places the model against the other models on the same cohort", async () => {
    renderPage();
    await screen.findByText("Carom · Base");

    // Claude averages $5 on carom/base; GPT ($1) and Gemini ($2) are both below,
    // so it is more expensive than the whole field.
    const meter = screen.getByRole("meter", {
      name: /Cost per run: more expensive than/,
    });
    expect(meter.getAttribute("aria-valuenow")).toBe("100");
    expect(
      screen.getByText(/Measured against the 2 other models/),
    ).toBeTruthy();
  });

  it("switches cohorts through the variant picker", async () => {
    renderPage();
    await screen.findByText("Carom · Base");

    fireEvent.change(screen.getByLabelText("Variant"), {
      target: { value: "hard-mode" },
    });

    expect(await screen.findByText("Carom · Hard Mode")).toBeTruthy();
    expect(labelledValue("Carom · Hard Mode", "Runs")).toBe("1");
    expect(labelledValue("Carom · Hard Mode", "Mean cost")).toBe("$3.00");
  });

  it("says so when the model is alone on a cohort", async () => {
    renderPage();
    await screen.findByText("Carom · Base");

    fireEvent.change(screen.getByLabelText("Test case"), {
      target: { value: "space-invaders" },
    });

    expect(
      await screen.findByText(
        /Claude is the only model with completed runs of Space Invaders/,
      ),
    ).toBeTruthy();
  });

  it("hides the variant picker for a case with one variant", async () => {
    renderPage();
    await screen.findByText("Carom · Base");

    fireEvent.change(screen.getByLabelText("Test case"), {
      target: { value: "space-invaders" },
    });

    expect(await screen.findByText("Space Invaders")).toBeTruthy();
    expect(screen.queryByLabelText("Variant")).toBeNull();
  });

  it("invites a first run for a model with no published runs", async () => {
    renderPage([]);

    expect(
      await screen.findByText(/No published runs have used Claude yet/),
    ).toBeTruthy();
  });
});

// A tile's value, found through its label so the assertion doesn't depend on the
// tile grid's order. Scoped to the figures list, because the surrounding page
// chrome carries its own "Runs" (the topbar's section link). A tile is a label
// span followed by a value span.
function labelledValue(cohort: string, label: string): string | null {
  const figures = screen.getByRole("list", { name: `${cohort} figures` });
  const tile = within(figures).getByText(label).parentElement;
  if (!tile) throw new Error(`no tile for ${label}`);
  return tile.lastElementChild?.textContent ?? null;
}
