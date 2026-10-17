import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Comparison } from "@clockwyrks/run-record/comparison";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkersContextValue,
} from "../../../client/context";
import type { WorkerClient } from "../../../client/clients";
import { ConfirmDialogProvider } from "../../components/ConfirmDialog";
import { ComparisonDetailPage } from "./ComparisonDetailPage";
import { capabilitySetFromDraft, emptyDraft } from "../runs/gg/ggConfigDraft";

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

// A one-arm comparison whose single arm is a gg configuration — the account's saved
// `minimal` configuration, bound to a model on its launch slot — with none of its `n`
// runs launched yet, so the trigger button has exactly one run to fire.
//
// The arm's models are keyed by **launch input**, and the input here is the root's own
// passthrough slot, which is asked for under `<slug>.<slot>`. Keying it by the bare slot
// name would bind nothing: `primary` is what the agent calls its slot, not what the launch
// form asks for, and a set that reached gg with an unfilled slot would be refused.
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
      engineSlug: "simple-2d",
    },
    arms: [
      {
        id: "arm-1",
        label: "gg minimal",
        ggConfigId: "saved:cfg-minimal",
        ggSlotModels: { "root.primary": "openai/gpt-5.6-sol" },
      },
    ],
    n: 1,
  },
  arms: [
    {
      arm: {
        id: "arm-1",
        label: "gg minimal",
        ggConfigId: "saved:cfg-minimal",
      },
      nDesired: 1,
      runIds: [],
      inFlight: 0,
      nObserved: 0,
      diagnostics: { tokens: NO_TOKENS },
    },
  ],
} as unknown as Comparison;

// The account's one saved gg configuration — what the arm above points at, now that
// there are no shared built-ins for it to name instead.
const SAVED_GG_CONFIG = {
  id: "cfg-minimal",
  name: "minimal",
  description: "the launchable baseline",
  capabilitySet: capabilitySetFromDraft(emptyDraft(), "minimal"),
  agentSources: [],
};

/** The same comparison wanting two runs, its cell already holding one run nobody
 *  launched from this page. */
const COMPARISON_WITH_EXISTING_RUN = {
  ...COMPARISON,
  config: { ...COMPARISON.config, n: 2 },
  arms: [
    {
      ...COMPARISON.arms[0]!,
      nDesired: 2,
      runIds: ["existing-1"],
      nObserved: 1,
    },
  ],
} as unknown as Comparison;

/** The same comparison with its one run still in flight: nothing to trigger, and
 *  not complete either. */
const COMPARISON_FULL = {
  ...COMPARISON,
  arms: [{ ...COMPARISON.arms[0]!, inFlight: 1 }],
} as unknown as Comparison;

/** The same comparison with its one run landed: complete. */
const COMPARISON_COMPLETE = {
  ...COMPARISON,
  arms: [{ ...COMPARISON.arms[0]!, runIds: ["alive-1"], nObserved: 1 }],
  complete: true,
} as unknown as Comparison;

function backendValue(
  overrides: Record<string, unknown> = {},
): BackendContextValue {
  return {
    client: {
      getComparison: vi.fn().mockResolvedValue(COMPARISON),
      updateComparison: vi.fn().mockResolvedValue(COMPARISON),
      listGgConfigs: vi.fn().mockResolvedValue([SAVED_GG_CONFIG]),
      ...overrides,
    },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

// A single worker; the mocked account's token clears the sign-in gate.
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
      url: "https://worker.example",
      client,
      identity: null,
      backendMatch: "unknown",
    },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
}

function renderPage(
  launchGgRun: WorkerClient["launchGgRun"],
  backendOverrides: Record<string, unknown> = {},
) {
  return render(
    <MemoryRouter initialEntries={["/comparisons/cmp-1"]}>
      <ConfirmDialogProvider>
        <BackendProvider value={backendValue(backendOverrides)}>
          <WorkersProvider value={workersValue(launchGgRun)}>
            <Routes>
              <Route
                path="/comparisons/:id"
                element={<ComparisonDetailPage />}
              />
              <Route path="/runs/comparisons" element={<div>the list</div>} />
            </Routes>
          </WorkersProvider>
        </BackendProvider>
      </ConfirmDialogProvider>
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
      // The comparison's held-constant engine, on the gg launch as well as the
      // harness one — an engineless arm would be doing different work from the
      // one it is compared against.
      engine: "simple-2d",
      state: "queued",
    });
  });

  it("launches a gg arm's runs under the comparison's engine", async () => {
    const launchGgRun = vi.fn().mockResolvedValue({ jobId: "job-9" });
    renderPage(launchGgRun);

    fireEvent.click(await screen.findByRole("button", { name: /^Trigger/ }));
    await waitFor(() => expect(launchGgRun).toHaveBeenCalledTimes(1));
    expect(launchGgRun.mock.calls[0]![0]).toMatchObject({
      testCase: "carom",
      engine: "simple-2d",
    });
  });

  it("shows a refused launch's reason on the page", async () => {
    const launchGgRun = vi
      .fn()
      .mockRejectedValue(
        new Error("`anthropic/claude-opus-4.8` has no provider candidate"),
      );
    renderPage(launchGgRun);

    fireEvent.click(await screen.findByRole("button", { name: /^Trigger/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "has no provider candidate",
    );
  });

  it("shows the held-constant engine on the controls strip", async () => {
    renderPage(vi.fn());
    expect(await screen.findByText("Engine")).toBeInTheDocument();
    expect(screen.getByText("Simple 2D")).toBeInTheDocument();
  });

  it("launches only what the arm's existing runs leave it short of, and writes nothing back", async () => {
    // The arm's cell already holds a run launched somewhere else, so one of the two
    // runs is all that is missing.
    const launchGgRun = vi.fn().mockResolvedValue({ jobId: "job-new" });
    const updateComparison = vi.fn();
    const getComparison = vi
      .fn()
      .mockResolvedValue(COMPARISON_WITH_EXISTING_RUN);
    renderPage(launchGgRun, { getComparison, updateComparison });

    fireEvent.click(
      await screen.findByRole("button", { name: "Trigger missing runs (1)" }),
    );
    await waitFor(() => expect(launchGgRun).toHaveBeenCalledTimes(1));
    // The comparison is read back to learn what its arms now hold, and the stored
    // configuration is left alone.
    await waitFor(() => expect(getComparison).toHaveBeenCalledTimes(2));
    expect(updateComparison).not.toHaveBeenCalled();
  });

  it("keeps the trigger button visible and says why it is doing nothing", async () => {
    renderPage(vi.fn(), {
      getComparison: vi.fn().mockResolvedValue(COMPARISON_FULL),
    });
    const button = await screen.findByRole("button", {
      name: "Trigger missing runs",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      expect.stringContaining(
        "holds or is waiting on 1 run, 1 still in flight",
      ),
    );
  });

  it("launches nothing for an arm the backend reports unlaunchable, and says why", async () => {
    const launchGgRun = vi.fn();
    renderPage(launchGgRun, {
      getComparison: vi.fn().mockResolvedValue({
        ...COMPARISON,
        arms: [
          {
            ...COMPARISON.arms[0]!,
            unlaunchable: "it imports an agent edited since it was saved",
          },
        ],
      }),
    });

    expect(
      await screen.findByText(/cannot be launched: it imports an agent/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Trigger missing runs" }),
    ).toBeDisabled();
    expect(launchGgRun).not.toHaveBeenCalled();
  });

  it("says a complete comparison is complete and launches nothing", async () => {
    renderPage(vi.fn(), {
      getComparison: vi.fn().mockResolvedValue(COMPARISON_COMPLETE),
    });

    expect(
      await screen.findByText(/^Complete: every configuration holds its 1 run/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Trigger missing runs" }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Run again" })).toBeNull();
  });

  it("deletes the comparison through the themed dialog, then leaves for the list", async () => {
    const deleteComparison = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    renderPage(vi.fn(), { deleteComparison });

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    // The app's own modal, never the browser's.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Delete comparison");
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete comparison" }));
    await waitFor(() =>
      expect(deleteComparison).toHaveBeenCalledWith("cmp-1", "t"),
    );
    // The page it was on is gone, so it leaves for the list.
    expect(await screen.findByText("the list")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("asks before deleting and does nothing when the answer is no", async () => {
    const deleteComparison = vi.fn().mockResolvedValue(undefined);
    renderPage(vi.fn(), { deleteComparison });

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleteComparison).not.toHaveBeenCalled();
  });
});
