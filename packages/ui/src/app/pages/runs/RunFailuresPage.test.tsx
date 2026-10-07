import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "@clockwyrks/run-record";
import { RunFailuresPage } from "./RunFailuresPage";
import { describeRunState } from "../../data/runState";

// A publishable failure as the worklist reads it: the tier, the recorded failure
// detail, and nothing else this page needs.
function failure(state: RunRecord["status"]["state"], detail: string) {
  return {
    record: {
      id: `run-${state}`,
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T01:00:00Z",
      status: { state, detail },
      subject: {
        testCaseSlug: "pong",
        variant: "base",
        modelId: "some-model",
        harnessSlug: "gg",
      },
    } as unknown as RunRecord,
    published: false,
  };
}

const failures = [
  failure("harness_error", "run failed: gg harness exited nonzero (code 1)"),
  failure(
    "limit_exceeded",
    "run failed: gg execution ceiling hit (5 consecutive turns failed)",
  ),
];

vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => ({ canExecute: true }),
}));
const workers = {
  active: { client: { listFailures: async () => failures, publish: vi.fn() } },
  workers: [],
};
vi.mock("../../../client/context", () => ({
  useWorkers: () => workers,
  useOptionalWorkers: () => workers,
  useOptionalBackend: () => null,
}));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "tok" }),
}));
vi.mock("../../runtime/runsRuntime", () => ({
  useRunsRuntime: () => ({ refreshToken: 0, requestRefresh: () => {} }),
}));
vi.mock("./StopRunsControls", () => ({
  StopRunsControls: () => null,
  useCanStopRuns: () => false,
}));
vi.mock("../../data/useModels", () => ({
  useFindModel: () => () => ({ name: "Some Model" }),
}));
vi.mock("../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));

describe("RunFailuresPage", () => {
  it("shows the recorded failure detail and keeps the tier's consequence one tap away", async () => {
    // The row's detail is the run's own error — what the harness reported, with
    // its figures. What the *tier* means for a publish (what is released, what
    // statistic it lands in, why a harness error is a judgement call) is not part
    // of that error, so it rides a help tip beside the chip instead of being
    // spliced onto the message. The operator decides here, so it has to be here.
    render(
      <MemoryRouter>
        <RunFailuresPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        "run failed: gg execution ceiling hit (5 consecutive turns failed)",
      ),
    ).toBeTruthy();

    for (const state of ["harness_error", "limit_exceeded"] as const) {
      expect(
        screen.getByLabelText(describeRunState(state).consequence),
      ).toBeTruthy();
    }
  });
});
