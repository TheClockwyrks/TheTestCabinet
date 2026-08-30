import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../../client/auth";
import type { WorkerClient } from "../../../client/clients";
import { WorkersProvider } from "../../../client/context";
import type { WorkersContextValue } from "../../../client/context";
import type { InProgressRun } from "../../../client/types";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import type { RunQuery, RunQueryResult } from "../../data/runQuery";
import { runSummaryPage } from "../../data/runQuery";
import {
  RunsRuntimeProvider,
  useRunsRuntime,
  type RunsRuntime,
} from "../../runtime/runsRuntime";
import type { TestCaseSummary } from "../../data/testCases";
import { RunsPage } from "./RunsPage";

// A run summary carrying only the fields the run log and the query read.
function summary(
  id: string,
  slug: string,
  opts: { published?: boolean; startedAt?: string; version?: string } = {},
): RunSummary {
  const {
    published = true,
    startedAt = "2026-01-01T00:00:00Z",
    version = "v1.0.0",
  } = opts;
  return {
    id,
    publishedAt: published ? "2026-01-02T00:00:00Z" : "",
    startedAt,
    finishedAt: startedAt,
    subject: {
      testCaseSlug: slug,
      testCaseVersion: version,
      testType: "end-to-end",
      variant: "base",
      harnessSlug: "claude",
      harnessVersion: "1",
      modelId: "anthropic/claude",
    },
    metrics: {
      runTimeSeconds: 60,
      tokens: {
        uncachedInput: 100,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: { comparable: 1, actual: 1 },
    },
    state: "completed",
    rating: null,
  } as unknown as RunSummary;
}

const TEST_CASES = [
  // Alpha is the only multi-version case, so its versions are what the version
  // facet must offer once Alpha is selected.
  {
    slug: "alpha",
    name: "Alpha",
    versions: ["v2.0.0", "v1.0.0"],
    latestVersion: "v2.0.0",
  },
  { slug: "beta", name: "Beta", versions: ["v1.0.0"], latestVersion: "v1.0.0" },
  {
    slug: "gamma",
    name: "Gamma",
    versions: ["v1.0.0"],
    latestVersion: "v1.0.0",
  },
] as unknown as TestCaseSummary[];

// The cabinet this fake host holds: two published runs and — newest — one still
// unpublished, i.e. one nobody has reviewed yet. Deliberately neither in
// alphabetical order nor grouped by publish state.
const PUBLISHED_NEW = summary("r-gamma", "gamma", {
  startedAt: "2026-01-03T00:00:00Z",
});
const UNPUBLISHED = summary("r-alpha", "alpha", {
  published: false,
  startedAt: "2026-01-02T00:00:00Z",
  version: "v2.0.0",
});
// Alpha's superseded v1: in the cabinet, but out of scope by default.
const PUBLISHED_STALE = summary("r-alpha-old", "alpha", {
  startedAt: "2026-01-04T00:00:00Z",
  version: "v1.0.0",
});
const PUBLISHED_OLD = summary("r-beta", "beta", {
  startedAt: "2026-01-01T00:00:00Z",
});
const ALL_RUNS = [PUBLISHED_NEW, UNPUBLISHED, PUBLISHED_OLD, PUBLISHED_STALE];

// A host that answers a summary query the way the backend does: the `any` slice
// sees every run, `published` only the published ones. Records each query so a
// test can assert what the page asked the server for.
function galleryValue(
  queries: RunQuery[],
  opts: { total?: number } = {},
): GalleryDataInput {
  return {
    // The produced worklist the console holds locally. A listing must NOT merge
    // this in — the queried slice already carries the run.
    producedSummaries: [UNPUBLISHED],
    localIds: new Set([UNPUBLISHED.id]),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async (query: RunQuery): Promise<RunQueryResult> => {
      queries.push(query);
      const rows =
        query.state === "any"
          ? ALL_RUNS
          : ALL_RUNS.filter((run) => run.publishedAt);
      const page = runSummaryPage(rows, { ...query, state: "published" });
      // A cabinet larger than one page: the backend's total counts every row the
      // same query can serve, across the pages it takes to serve them.
      return opts.total == null ? page : { ...page, total: opts.total };
    },
    testCases: TEST_CASES,
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

function renderPage(queries: RunQuery[], opts: { total?: number } = {}) {
  return render(
    <MemoryRouter>
      <GalleryDataProvider value={galleryValue(queries, opts)}>
        <RunsPage />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

// The rendered run rows, in DOM order, as their leading test-case name.
function rowNames(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.textContent ?? "")
    .flatMap((text) =>
      ["Alpha", "Beta", "Gamma"].filter((n) => text.includes(n)),
    );
}

describe("RunsPage", () => {
  beforeEach(() => localStorage.clear());

  it("draws from the union slice so unreviewed runs are not pinned first", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);

    // Date-descending by default: the unpublished (unreviewed) run sits in the
    // middle by its own date, not hoisted to the top of the page.
    await waitFor(() => expect(rowNames()).toEqual(["Gamma", "Alpha", "Beta"]));
    expect(queries[0]).toMatchObject({
      state: "any",
      offset: 0,
      limit: 20,
      sort: "date",
      dir: "desc",
    });
  });

  it("sizes the pager from the returned total and nothing else", async () => {
    // The backend's `total` counts exactly the rows the same query can serve, so
    // three rows over a page size of 20 is one page and the pager is absent rather
    // than offering a second page that would render nothing.
    const queries: RunQuery[] = [];
    renderPage(queries);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("offers every page the total covers and asks the server for its offset", async () => {
    // The other direction of the same rule: a total spanning three pages offers
    // exactly three, and the page the reader picks travels as the query's offset
    // rather than being sliced out of the rows already in hand.
    const queries: RunQuery[] = [];
    renderPage(queries, { total: 45 });
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    const third = screen.getByRole("button", { name: "Page 3" });
    expect(screen.queryByRole("button", { name: "Page 4" })).toBeNull();

    fireEvent.click(third);
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ offset: 40 }));
  });

  it("re-queries the server on a header sort instead of sorting the page", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Sort by TEST" }));

    // The sort travels as the column's server key, still over the union slice and
    // back at the first page — and the unreviewed run sorts by name like any other.
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({
        state: "any",
        sort: "testCase",
        dir: "asc",
        offset: 0,
      }),
    );
    await waitFor(() => expect(rowNames()).toEqual(["Alpha", "Beta", "Gamma"]));
  });

  it("sends the search to the server rather than filtering the page", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    fireEvent.change(screen.getByRole("searchbox", { name: "Search runs" }), {
      target: { value: "alpha" },
    });

    // Debounced, then queried server-side: the page holds only the matching row,
    // and the produced worklist is not searched client-side beside it.
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ state: "any", q: "alpha" }),
    );
    await waitFor(() => expect(rowNames()).toEqual(["Alpha"]));
  });

  it("scopes to each case's current version by default, and can be widened", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);

    // Alpha is on v2, so its superseded v1 run is out of scope even though it is
    // the newest run in the cabinet — a run against a different spec is not
    // comparable with the current one's.
    await waitFor(() => expect(rowNames()).toEqual(["Gamma", "Alpha", "Beta"]));
    expect(queries[0]).toMatchObject({ latestVersions: true });

    fireEvent.click(
      screen.getByRole("checkbox", { name: /current versions only/i }),
    );

    // Widened: the stale v1 run reappears, newest-first.
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ latestVersions: false }),
    );
    await waitFor(() =>
      expect(rowNames()).toEqual(["Alpha", "Gamma", "Alpha", "Beta"]),
    );
  });

  it("filters by an exact version once a case narrows the choice", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    // A version only means something within a case, so the facet waits for one.
    expect(screen.getByRole("combobox", { name: "Version" })).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Test case" }), {
      target: { value: "alpha" },
    });
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ testCase: "alpha" }),
    );

    const version = screen.getByRole("combobox", { name: "Version" });
    expect(version).toBeEnabled();
    fireEvent.change(version, { target: { value: "v1.0.0" } });

    // The exact version overrides the current-version toggle — asking for an older
    // version must show it, not silently empty the listing.
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({
        testCase: "alpha",
        version: "v1.0.0",
      }),
    );
    await waitFor(() => expect(rowNames()).toEqual(["Alpha"]));
  });

  it("clears every filter back to the default view", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    // The harness facet offers the first-party gg run mode alongside the CLI
    // catalog — gg runs record `harnessSlug: "gg"` and must be filterable.
    const harnessSelect = screen.getByRole("combobox", { name: "Harness" });
    expect(
      Array.from(harnessSelect.querySelectorAll("option")).map((o) => o.value),
    ).toContain("gg");
    fireEvent.change(harnessSelect, { target: { value: "gg" } });
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ harness: "gg" }),
    );

    fireEvent.change(harnessSelect, {
      target: { value: "codex" },
    });
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ harness: "codex" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({
        harness: undefined,
        latestVersions: true,
      }),
    );
    await waitFor(() => expect(rowNames()).toEqual(["Gamma", "Alpha", "Beta"]));
  });
});

// --- The runs tab bar's global stop controls ---

// One in-flight run in the given phase, as the reconciled active list holds it.
function active(runId: string, state: InProgressRun["state"]): InProgressRun {
  return {
    runId,
    testCaseSlug: "delta",
    testCaseVersion: "v1.0.0",
    variant: "base",
    harnessSlug: "claude",
    modelId: "anthropic/claude",
    state,
  };
}

// Module-level so the seeding effect below has a stable dependency and runs once
// rather than re-tracking on every render the tracking itself provokes.
const TWO_WAITING = [
  active("j-queued", "queued"),
  active("j-pending", "pending"),
];
const ONE_RUNNING = [active("j-running", "running")];

// Seeds the runs runtime with an in-flight set, standing in for the reconcile poll
// that normally fills it from every worker's `GET /jobs/active`. The controls read
// that list to decide which sweeps have anything to do.
function SeedActive({ runs }: { runs: InProgressRun[] }) {
  const { track } = useRunsRuntime();
  useEffect(() => {
    for (const run of runs) track(run);
  }, [runs, track]);
  return null;
}

// The three sweeps as spies, plus the workers context wrapping them. Each answers
// the way the backend does — a count, and which slices it reached — so the test can
// assert the console reports the count rather than just succeeding quietly.
function stopWorkers() {
  const cancelWaitingRuns = vi.fn(async () => ({
    canceled: 2,
    includedWaiting: true,
    includedActive: false,
  }));
  const cancelActiveRuns = vi.fn(async () => ({
    canceled: 1,
    includedWaiting: false,
    includedActive: true,
  }));
  const cancelAllRuns = vi.fn(async () => ({
    canceled: 3,
    includedWaiting: true,
    includedActive: true,
  }));
  const client = {
    cancelWaitingRuns,
    cancelActiveRuns,
    cancelAllRuns,
  } as unknown as WorkerClient;
  const value = {
    workers: [],
    activeId: "w1",
    active: { id: "w1", label: "Worker", url: null, local: true, client },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
  return { value, cancelWaitingRuns, cancelActiveRuns, cancelAllRuns };
}

// The console as the controls require it: a cancel-capable worker, a signed-in
// account (seeded the way a reload restores one), and a seeded in-flight list.
function renderConsole(runs: InProgressRun[]) {
  localStorage.setItem(
    "tcab.auth",
    JSON.stringify({ token: "tok", account: { username: "zach" } }),
  );
  const workers = stopWorkers();
  render(
    <MemoryRouter>
      <WorkersProvider value={workers.value}>
        <AuthProvider>
          <RunsRuntimeProvider>
            <SeedActive runs={runs} />
            <GalleryDataProvider value={galleryValue([])}>
              <RunsPage />
            </GalleryDataProvider>
          </RunsRuntimeProvider>
        </AuthProvider>
      </WorkersProvider>
    </MemoryRouter>,
  );
  return workers;
}

describe("RunsPage global stop controls", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("hides them where the transport cannot cancel", async () => {
    // The bare host has no worker and no token: the cluster is absent rather than
    // rendered as three buttons that fail when pressed.
    renderPage([]);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    expect(screen.queryByRole("group", { name: "Stop runs" })).toBeNull();
    // And the header does not lay its comment line out for a cluster that never
    // arrives: the comment sits straight in the header rather than as one half of a
    // row shared with something that renders nothing.
    const comment = screen.getByText(
      "// every result the cabinet has produced",
    );
    expect(comment.parentElement?.tagName).toBe("HEADER");
  });

  // The cluster used to ride the trailing edge of the tab strip, which worked until the
  // strip grew a fifth tab: five tabs and three buttons is a bar that wraps onto a second
  // row at an ordinary window width, and the row it wrapped onto pushed the page down. It
  // sits on the header's comment line instead, which is a half-empty row already.
  it("sits in the page header rather than in the tab strip", async () => {
    renderConsole(TWO_WAITING);

    const group = await screen.findByRole("group", { name: "Stop runs" });
    const tabs = screen.getByRole("navigation", { name: "Runs sections" });
    expect(tabs).not.toContainElement(group);
    // On the comment line itself: the cluster and the comment share a parent, and that
    // row is inside the page header.
    const comment = screen.getByText(
      "// every result the cabinet has produced",
    );
    expect(group.parentElement?.parentElement).toBe(comment.parentElement);
    const header = comment.closest("header");
    expect(header).not.toBeNull();

    // And that row is the header's own, a sibling of the row the New-run button is on
    // rather than a column of it. A header laid out as one column of somebody else's
    // row gives its comment line only that column's width, which is not enough for the
    // three buttons — they wrap onto a row of their own, which is the whole thing
    // moving them here was meant to avoid.
    const newRun = screen.getByRole("link", { name: "+ New run" });
    expect(newRun.parentElement?.parentElement?.parentElement).toBe(header);
    expect(comment.parentElement?.parentElement).toBe(header);
  });

  it("clears the waiting queue and reports how many it cancelled", async () => {
    const { cancelWaitingRuns } = renderConsole(TWO_WAITING);

    const clear = await screen.findByRole("button", { name: "Clear pending" });
    // Nothing is executing, so only the sweeps that would do something are live.
    expect(screen.getByRole("button", { name: "Kill active" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop all" })).toBeEnabled();

    fireEvent.click(clear);

    // Cheap enough to need no confirmation — it discards no work — and the count
    // comes back in the bar rather than the press simply succeeding quietly.
    await waitFor(() => expect(cancelWaitingRuns).toHaveBeenCalledWith("tok"));
    await screen.findByText("Canceled 2 waiting runs.");
  });

  it("confirms before killing runs that are already executing", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { cancelActiveRuns } = renderConsole(ONE_RUNNING);

    const kill = await screen.findByRole("button", { name: "Kill active" });
    // Nothing is waiting, so the queue sweep has nothing to clear.
    expect(
      screen.getByRole("button", { name: "Clear pending" }),
    ).toBeDisabled();

    fireEvent.click(kill);
    // Declined: the work keeps running and nothing reaches the transport.
    expect(confirm).toHaveBeenCalledOnce();
    expect(cancelActiveRuns).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(kill);

    await waitFor(() => expect(cancelActiveRuns).toHaveBeenCalledWith("tok"));
    await screen.findByText("Canceled 1 executing run.");
  });
});

// --- A run finishing while the listing is filtered ---

// The runs runtime as the console's notification layer holds it, captured from
// inside the provider so a test can drive exactly what a completion push does:
// prune the finished run from the in-progress list, then ask the data source to
// re-read.
function CaptureRuntime({ into }: { into: { current: RunsRuntime | null } }) {
  into.current = useRunsRuntime();
  return null;
}

// A cabinet the test mutates: the host answers every query off this array, so a
// run "landing" server-side is a push rather than a re-render of fixed data.
function liveGalleryValue(
  cabinet: RunSummary[],
  queries: RunQuery[],
): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set<string>(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async (query: RunQuery): Promise<RunQueryResult> => {
      queries.push(query);
      return runSummaryPage(cabinet, { ...query, state: "published" });
    },
    testCases: TEST_CASES,
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

// The one in-flight run, on the case the listing is filtered to.
const ALPHA_ACTIVE = [
  {
    ...active("j-alpha", "running"),
    testCaseSlug: "alpha",
    testCaseVersion: "v2.0.0",
  },
];

// The record that run leaves behind once it finishes.
const ALPHA_FINISHED = summary("r-alpha-live", "alpha", {
  published: false,
  startedAt: "2026-01-05T00:00:00Z",
  version: "v2.0.0",
});

// Every run link the log is currently showing, as its href.
function rowLinks(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.getAttribute("href") ?? "");
}

describe("RunsPage with a filter applied", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a run in the list when it finishes", async () => {
    const cabinet: RunSummary[] = [];
    const queries: RunQuery[] = [];
    const runtime = { current: null as RunsRuntime | null };
    render(
      <MemoryRouter initialEntries={["/runs?case=alpha"]}>
        <RunsRuntimeProvider>
          <CaptureRuntime into={runtime} />
          <SeedActive runs={ALPHA_ACTIVE} />
          <GalleryDataProvider value={liveGalleryValue(cabinet, queries)}>
            <RunsPage />
          </GalleryDataProvider>
        </RunsRuntimeProvider>
      </MemoryRouter>,
    );

    // The filtered listing holds nothing yet; the in-flight run leads it, linked
    // to its live monitor.
    await waitFor(() => expect(rowLinks()).toContain("/runs/j-alpha/live"));
    expect(queries[0]).toMatchObject({ testCase: "alpha" });

    // The run finishes: its record lands in the cabinet, the notification layer
    // prunes it from the in-progress list and asks the data source to re-read.
    await act(async () => {
      cabinet.push(ALPHA_FINISHED);
      runtime.current!.remove("j-alpha");
      runtime.current!.requestRefresh();
    });

    // It must not vanish: the pinned live row gives way to the recorded row, still
    // inside the same filtered query rather than only after a reload.
    await waitFor(() => expect(rowLinks()).toContain("/runs/r-alpha-live"));
    expect(rowLinks()).not.toContain("/runs/j-alpha/live");
    expect(queries.at(-1)).toMatchObject({ state: "any", testCase: "alpha" });
  });
});
