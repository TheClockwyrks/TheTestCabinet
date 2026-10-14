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

const failures: (ReturnType<typeof failure> & {
  artifactsStored?: boolean | null;
  artifactsReclaimed?: { at: string; reason: string } | null;
})[] = [
  failure("harness_error", "run failed: gg harness exited nonzero (code 1)"),
  failure(
    "limit_exceeded",
    "run failed: gg execution ceiling hit (5 consecutive turns failed)",
  ),
  // A failure whose driver could not store its tree: nothing to release.
  {
    ...failure("catastrophic", "run failed: the build never loaded"),
    artifactsStored: false,
  },
  // A failure whose tree was removed after its retention: nothing to release
  // either, and nothing wrong.
  {
    ...failure("timed_out", "run failed: the run hit its maximum runtime"),
    artifactsStored: false,
    artifactsReclaimed: { at: "2026-10-12T00:00:00Z", reason: "failed" },
  },
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

  it("offers no publish for a failure whose artifacts are not stored", async () => {
    render(
      <MemoryRouter>
        <RunFailuresPage />
      </MemoryRouter>,
    );

    const missing = await screen.findByTestId("artifacts-missing");
    expect(missing.textContent).toBe("No stored artifacts");
    expect(missing.getAttribute("title")).toContain("cannot be published");
    // The two failures whose trees are not known to be missing keep their
    // Publish control; the other rows have a marker in its place.
    expect(screen.getAllByRole("button", { name: "Publish" })).toHaveLength(2);
    // Exactly one row is the lost tree: the reclaimed one is not counted as it.
    expect(screen.getAllByTestId("artifacts-missing")).toHaveLength(1);
  });

  it("says a reclaimed failure's artifacts were removed, without calling them missing", async () => {
    render(
      <MemoryRouter>
        <RunFailuresPage />
      </MemoryRouter>,
    );

    const removed = await screen.findByTestId("artifacts-reclaimed");
    expect(removed.textContent).toBe("Artifacts removed");
    expect(removed.getAttribute("title")).toContain(
      "removed after the retention period",
    );
    expect(screen.getAllByTestId("artifacts-reclaimed")).toHaveLength(1);
  });
});
