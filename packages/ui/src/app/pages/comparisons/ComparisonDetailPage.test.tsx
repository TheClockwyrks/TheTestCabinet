import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Comparison } from "@test-cabinet/run-record/comparison";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkersContextValue,
} from "../../../client/context";
import type { WorkerClient } from "../../../client/clients";
import { ComparisonDetailPage } from "./ComparisonDetailPage";

// The page's app chrome reads contexts (gallery data, backdrop settings) that have
// nothing to do with the trigger path under test.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// Signed in, because a comparison is per-account — the page refuses to render
// without a token on an executing console.
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t" }),
}));
// An executing console (so the action bar and its trigger button render) whose
// gallery source has no published comparison to fall back on — the backend below
// is the only place this comparison comes from.
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => ({ canExecute: true, readComparison: undefined }),
}));
vi.mock("../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));
// The runs runtime a launch registers its enqueued run with. Hoisted so the mock
// factory (which vitest lifts above the imports) closes over the same spy the
// tests assert on.
const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../runtime/runsRuntime", () => ({
  useRunsRuntime: () => ({ inProgress: [], track }),
}));

const NO_TOKENS = {
  uncachedInput: null,
  cachedInput: null,
  output: null,
  reasoning: null,
};

// A one-arm comparison whose single arm is a gg configuration — the shared
// `minimal` built-in, bound to a model on its launch slot — with none of its `n`
// runs launched yet, so the trigger button has exactly one run to fire.
const COMPARISON = {
  id: "cmp-1",
  userId: "u-1",
  name: "gg minimal",
  description: "",
  published: false,
  createdAt: "2026-07-30T00:00:00Z",
  updatedAt: "2026-07-30T00:00:00Z",
  config: {
    controls: {
      caseSlug: "carom",
      version: "v1.0.0",
      variant: "base",
      orchestratorSlug: "one-shot",
    },
    arms: [
      {
        id: "arm-1",
        label: "gg minimal",
        ggConfigId: "builtin:minimal",
        ggSlotModels: { primary: "openai/gpt-5.6-sol" },
        runIds: [],
      },
    ],
    n: 1,
  },
  arms: [
    {
      arm: { id: "arm-1", label: "gg minimal", ggConfigId: "builtin:minimal" },
      nDesired: 1,
      nObserved: 0,
      diagnostics: { tokens: NO_TOKENS },
    },
  ],
} as unknown as Comparison;

function backendValue(): BackendContextValue {
  return {
    client: {
      getComparison: vi.fn().mockResolvedValue(COMPARISON),
      updateComparison: vi.fn().mockResolvedValue(COMPARISON),
      listGgConfigs: vi.fn().mockResolvedValue([]),
    },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

// A single local worker: `local: true` means no sign-in gates the launch itself.
function workersValue(
  launchGgRun: WorkerClient["launchGgRun"],
): WorkersContextValue {
  const client = { launchGgRun } as unknown as WorkerClient;
  return {
    workers: [],
    activeId: "local",
    active: {
      id: "local",
      label: "Local",
      url: null,
      local: true,
      client,
      identity: null,
      backendMatch: "unknown",
    },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
}

function renderPage(launchGgRun: WorkerClient["launchGgRun"]) {
  return render(
    <MemoryRouter initialEntries={["/comparisons/cmp-1"]}>
      <BackendProvider value={backendValue()}>
        <WorkersProvider value={workersValue(launchGgRun)}>
          <Routes>
            <Route path="/comparisons/:id" element={<ComparisonDetailPage />} />
          </Routes>
        </WorkersProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("ComparisonDetailPage", () => {
  beforeEach(() => {
    track.mockClear();
  });

  it("tracks a triggered gg arm run by the configuration it was launched from", async () => {
    const launchGgRun = vi.fn().mockResolvedValue({ jobId: "job-9" });
    renderPage(launchGgRun);

    fireEvent.click(await screen.findByRole("button", { name: /^Trigger/ }));
    await waitFor(() => expect(launchGgRun).toHaveBeenCalledTimes(1));

    // This is the second place the console launches a gg run, and it has to seed the
    // in-progress row with the same identity the new-run form does. `ggPreset` in
    // particular is what the runs list shows a gg row by, in place of a model that
    // names only the root agent — and nothing backfills it: the reconcile only
    // patches `state` on a row it already tracks, so a row seeded without it would
    // read as its root model until the page was reloaded.
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    expect(track.mock.calls[0]![0]).toEqual({
      runId: "job-9",
      testCaseSlug: "carom",
      testCaseVersion: "v1.0.0",
      variant: "base",
      harnessSlug: "gg",
      modelId: "openai/gpt-5.6-sol",
      ggPreset: "minimal",
      state: "queued",
    });
  });
});
