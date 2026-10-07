import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { RunMetrics, RunRecord } from "@clockwyrks/run-record";
import { RunMetricsPage } from "./RunMetricsPage";

// The Metrics tab reports a run's durations beside its tokens and cost, and the
// rule that keeps them honest is that an absent duration renders as an em dash.
// A record written before the stage durations were measured carries none, and a
// canceled run records no validation duration; either printed as `0s` would read
// as a stage that finished instantly.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/RunDeleteControl", () => ({
  RunDeleteControl: () => null,
}));
vi.mock("../../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));
vi.mock("../../../data/useModels", () => ({
  useFindModel: () => () => null,
}));
const fixture = vi.hoisted(() => ({ detail: null as unknown }));
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => ({
    fetchRun: async () => fixture.detail,
    localIds: new Set<string>(),
    writeups: {},
    canExecute: false,
  }),
}));

const RUN_ID = "run-metrics";

function renderPage(metrics: Partial<RunMetrics>) {
  fixture.detail = {
    record: {
      id: RUN_ID,
      subject: {
        testCaseSlug: "coil",
        testCaseVersion: "v1.0.0",
        testType: "end-to-end",
        variant: "base",
        harnessSlug: "gg",
        harnessVersion: "0.7.0",
        modelId: "test/model",
      },
      status: { state: "completed", detail: null },
      validation: { loaded: true, proofs: [] },
      metrics: {
        runTimeSeconds: 900,
        tokens: {
          uncachedInput: 100,
          cachedInput: 20,
          output: 50,
          reasoning: 5,
        },
        cost: { comparable: 1.5, actual: 1.5 },
        ...metrics,
      },
    } as unknown as RunRecord,
    reviews: [],
  };
  return render(
    <MemoryRouter initialEntries={[`/runs/${RUN_ID}/metrics`]}>
      <Routes>
        <Route path="/runs/:runId/metrics" element={<RunMetricsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// A tile's value, found through its label. A tile is a label followed by a value.
function tile(label: string): string | null {
  const node = screen.getByText(label);
  return node.parentElement?.textContent?.slice(label.length) ?? null;
}

describe("RunMetricsPage", () => {
  it("breaks the run time down into its stages", async () => {
    renderPage({
      runTimeSeconds: 900,
      setupSeconds: 600,
      sessionSeconds: 270,
      teardownSeconds: 30,
      validationSeconds: 45,
    });

    expect(await screen.findByText("Run time")).toBeInTheDocument();
    expect(tile("Run time")).toBe("15m 0s");
    // Setup, session and teardown partition the run time; validation sits
    // outside it, because the run time is frozen before validation runs.
    expect(tile("Setup")).toBe("10m 0s");
    expect(tile("Session")).toBe("4m 30s");
    expect(tile("Teardown")).toBe("30s");
    expect(tile("Validation")).toBe("45s");
  });

  it("shows an em dash for a stage the run recorded no figure for", async () => {
    // A record written before the stage durations were measured still carries a
    // run time, and must not claim its session took no time at all.
    renderPage({ runTimeSeconds: 900 });

    expect(await screen.findByText("Run time")).toBeInTheDocument();
    expect(tile("Run time")).toBe("15m 0s");
    for (const label of ["Setup", "Session", "Teardown", "Validation"]) {
      expect(tile(label)).toBe("—");
    }
  });

  it("shows an em dash for the validation a canceled run skipped", async () => {
    renderPage({
      runTimeSeconds: 900,
      setupSeconds: 600,
      sessionSeconds: 270,
      teardownSeconds: 30,
    });

    expect(await screen.findByText("Run time")).toBeInTheDocument();
    expect(tile("Session")).toBe("4m 30s");
    expect(tile("Validation")).toBe("—");
  });
});
