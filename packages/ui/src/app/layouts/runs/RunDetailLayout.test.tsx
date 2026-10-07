import { render, screen } from "@testing-library/react";
import type { RunRecord } from "@clockwyrks/run-record";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunDetailLayout } from "./RunDetailLayout";

// The layout's chrome reads app-wide contexts (backdrop settings, the worker
// connection the delete control needs) that say nothing about which tabs a run
// gets. Stub them so these tests exercise only the tab set and the header badge.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/RunDeleteControl", () => ({
  RunDeleteControl: () => null,
}));
vi.mock("../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));
vi.mock("../../data/useModels", () => ({
  useFindModel: () => () => null,
}));
// The run the layout resolves. Held in a hoisted cell so each test can swap the
// record in before rendering (a `vi.mock` factory is hoisted above module scope
// and so cannot close over an ordinary `let`).
const fixture = vi.hoisted(() => ({
  detail: null as unknown,
  // When set, `fetchRun` rejects with it instead of resolving — the read FAILED,
  // as distinct from the read settling with no record.
  failure: null as unknown,
  // When set, resolves per run id instead of handing back the single `detail` —
  // what the cache tests need, since a cache keyed by run id is only exercised
  // by runs that differ. Every call is recorded, so a test can see that a cache
  // HIT still refetched in the background.
  byId: null as ((runId: string) => unknown) | null,
  calls: [] as string[],
}));
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => ({
    fetchRun: async (runId: string) => {
      fixture.calls.push(runId);
      if (fixture.failure) throw fixture.failure;
      if (fixture.byId) return fixture.byId(runId);
      return fixture.detail;
    },
    localIds: new Set<string>(),
    writeups: {},
    canExecute: false,
  }),
}));

const RUN_ID = "run-1";

// A completed run of the given type. The layout reads the subject, the status,
// and (for the badge) the reviews fetched beside the record.
function record(
  testType: RunRecord["subject"]["testType"],
  harnessSlug = "claude",
  codeAnalysis?: RunRecord["codeAnalysis"],
  engine: { slug: string; version?: string } = {
    slug: "simple-2d",
    version: "1.0.0",
  },
): RunRecord {
  return {
    codeAnalysis,
    id: RUN_ID,
    subject: {
      testCaseSlug: "lattice",
      testCaseVersion: "v1.0.0",
      testType,
      variant: "base",
      harnessSlug,
      harnessVersion: "1.2.3",
      engineSlug: engine.slug,
      engineVersion: engine.version,
      modelId: "claude-sonnet-4-5",
    },
    status: { state: "completed", detail: null },
    // `proofs` is read unguarded when the layout decides whether to offer the
    // Proof tab; none of these fixtures declares proof media.
    validation: { loaded: true, proofs: [] },
  } as unknown as RunRecord;
}

// Stand the layout up for one run, with a single `great`-rated review attached so
// the header badge has something to render when the type allows one.
function renderLayout(
  testType: RunRecord["subject"]["testType"],
  harnessSlug?: string,
  codeAnalysis?: RunRecord["codeAnalysis"],
  engine?: { slug: string; version?: string },
) {
  fixture.failure = null;
  fixture.byId = null;
  fixture.detail = {
    record: record(testType, harnessSlug, codeAnalysis, engine),
    reviews: [
      {
        reviewerId: "u1",
        reviewer: { userId: "u1", username: "u1", displayName: "U One" },
        ratings: [{ domain: "approach", rating: "great" }],
        checklist: [],
        writeup: "Solid.",
        reviewedAt: "2026-06-18T00:00:00Z",
      },
    ],
  };
  return render(
    <MemoryRouter initialEntries={[`/runs/${RUN_ID}`]}>
      <Routes>
        <Route
          path="/runs/:runId"
          element={
            <RunDetailLayout tab="verdict">{() => null}</RunDetailLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailLayout header", () => {
  // The engine is a run dimension chosen at launch, beside the variant, and a
  // result is only comparable with another on the same engine — so a reviewer must
  // be able to read it off the page they are reviewing from, without opening
  // Metadata.
  it("names the engine beside the variant", async () => {
    renderLayout("end-to-end");
    expect(await screen.findByText("simple-2d")).toBeInTheDocument();
    expect(screen.getByText("base")).toBeInTheDocument();
  });

  it("names the engineless run's engine too, rather than saying nothing", async () => {
    // `none` is a selection, not an absence: the build supplied its own runtime.
    // Leaving the line blank there would read as "this page does not know", which
    // is the state this header exists to end.
    renderLayout("end-to-end", "claude", undefined, { slug: "none" });
    expect(await screen.findByText("none")).toBeInTheDocument();
  });
});

describe("RunDetailLayout tabs", () => {
  it("offers a gg tab on a gg run", async () => {
    renderLayout("end-to-end", "gg");
    // gg is the one harness The Test Cabinet has first-party telemetry for, so a gg
    // run keeps the rich view its live monitor showed instead of losing it once the
    // run ends.
    expect(await screen.findByRole("link", { name: "gg" })).toBeInTheDocument();
  });

  it("offers no gg tab on a third-party-harness run", async () => {
    renderLayout("end-to-end");
    await screen.findByRole("link", { name: "Verdict" });
    expect(screen.queryByRole("link", { name: "gg" })).toBeNull();
  });

  // The analyzer is harness-agnostic — analysing a directory involves no
  // harness-specific work — so the tab is gated on the run carrying an analysis
  // rather than on which harness produced it.
  it("offers a Code tab on any harness's run that carries an analysis", async () => {
    renderLayout("end-to-end", "claude", {
      analyzerVersion: 1,
    } as RunRecord["codeAnalysis"]);
    expect(
      await screen.findByRole("link", { name: "Code" }),
    ).toBeInTheDocument();
  });

  // The corpus is deliberately not backfilled, so a run recorded before the
  // analyzer shipped has nothing to show. It gets no tab rather than an empty one —
  // including a gg run, which is otherwise the best-instrumented run there is.
  it("offers no Code tab on a run with no analysis", async () => {
    renderLayout("end-to-end", "gg");
    await screen.findByRole("link", { name: "Verdict" });
    expect(screen.queryByRole("link", { name: "Code" })).toBeNull();
  });

  it("names the default tab Verdict for a human-reviewed run", async () => {
    renderLayout("end-to-end");
    expect(
      await screen.findByRole("link", { name: "Verdict" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Results" })).toBeNull();
  });

  it("names the default tab Results for an auto-graded performance run", async () => {
    renderLayout("performance");
    // A performance run is scored by the harness, so its default tab presents the
    // recorded result rather than a reviewer's verdict.
    expect(
      await screen.findByRole("link", { name: "Results" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Verdict" })).toBeNull();
    // It still has no Play tab — it produces no hostable build.
    expect(screen.queryByRole("link", { name: "Play" })).toBeNull();
  });

  it("shows no review rating badge for a performance run", async () => {
    renderLayout("performance");
    await screen.findByRole("link", { name: "Results" });
    // The badge is derived from a human review's per-domain ratings. A performance
    // run carries no review, so a stray rating riding along with the record must
    // not surface as a headline verdict on an automatically-scored run.
    expect(screen.queryByText(/great/i)).toBeNull();
  });

  it("names the default tab Results for an adversarial run and offers no Proof tab", async () => {
    renderLayout("adversarial");
    // An adversarial run is assessed on its match results alone, so its default
    // tab presents those results rather than a reviewer's verdict…
    expect(
      await screen.findByRole("link", { name: "Results" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Verdict" })).toBeNull();
    // …and it has no separate Proof tab (its match records are the result) and no
    // Play tab (it produces no hostable build).
    expect(screen.queryByRole("link", { name: "Proof" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Play" })).toBeNull();
  });

  it("shows no review rating badge for an adversarial run", async () => {
    renderLayout("adversarial");
    await screen.findByRole("link", { name: "Results" });
    // Like a performance run, an adversarial run carries no reviewer verdict, so a
    // stray rating riding along with the record must not surface as a badge.
    expect(screen.queryByText(/great/i)).toBeNull();
  });
});

// A run id no other test has used, so the layout's process-wide detail cache
// cannot answer for it and the fetch under test is the one that decides.
let unresolvedIds = 0;
function renderUnresolved(outcome: { failure?: unknown }) {
  const runId = `unresolved-${++unresolvedIds}`;
  fixture.detail = null;
  fixture.failure = outcome.failure ?? null;
  fixture.byId = null;
  render(
    <MemoryRouter initialEntries={[`/runs/${runId}`]}>
      <Routes>
        <Route
          path="/runs/:runId"
          element={
            <RunDetailLayout tab="verdict">{() => null}</RunDetailLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return runId;
}

// The report this pins: "if data is loading, the page must NEVER claim that the
// entity is not found". A read that FAILED is the same mistake one step further
// on — the page answering a question the request never got an answer to.
describe("RunDetailLayout when the run does not resolve", () => {
  it("names the run as not found once the read settles without one", async () => {
    const runId = renderUnresolved({});
    expect(
      await screen.findByText(`No run found for \u201c${runId}\u201d.`),
    ).toBeInTheDocument();
  });

  it("reports a failed read as a failure, never as a missing run", async () => {
    const runId = renderUnresolved({
      failure: new Error("/runs/x: HTTP 503: upstream unavailable"),
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not load");
    expect(alert.textContent).toContain("HTTP 503");
    // The whole point: the page must not have decided the run is absent.
    expect(
      screen.queryByText(`No run found for \u201c${runId}\u201d.`),
    ).toBeNull();
  });

  it("shows the loading state while the read is in flight", () => {
    renderUnresolved({});
    // Synchronously after mount the fetch has not settled, so neither verdict is
    // on screen yet.
    expect(screen.getByText("Loading run…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// The layout's session cache of resolved run details. It was a bare `Map` that
// nothing ever evicted — a whole `RunRecord` plus its reviews retained for every
// run the session ever opened — so these pin both halves of what folding it onto
// the bounded LRU primitive has to preserve: it forgets at its bound, and a hit
// is still only a head start on a fetch that runs anyway.

// One run's detail, distinguishable on screen by its variant (the header renders
// `subject.variant` verbatim).
function detailFor(runId: string, variant: string): unknown {
  const base = record("end-to-end");
  return {
    record: { ...base, id: runId, subject: { ...base.subject, variant } },
    reviews: [],
  };
}

// Mount the layout on one run id, with nothing else on screen. Returns the
// render so the caller can unmount before mounting the next — the cache is
// process-wide, so these tests walk through runs one at a time.
function renderRun(runId: string) {
  return render(
    <MemoryRouter initialEntries={[`/runs/${runId}`]}>
      <Routes>
        <Route
          path="/runs/:runId"
          element={
            <RunDetailLayout tab="verdict">{() => null}</RunDetailLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailLayout's session cache of run details", () => {
  // Keyed on a prefix no other test uses, so the shared cache carries nothing
  // into or out of these.
  beforeEach(() => {
    fixture.failure = null;
    fixture.detail = null;
    fixture.calls = [];
  });

  afterEach(() => {
    fixture.byId = null;
  });

  it("seeds a revisited run's chrome on the first frame, with no loading state", async () => {
    const runId = "cached-hit";
    fixture.byId = (id: string) => detailFor(id, "first-visit");
    const first = renderRun(runId);
    await screen.findByText("first-visit");
    first.unmount();

    const second = renderRun(runId);
    // Synchronously after mount: the chrome is already there, which is the whole
    // reason this cache exists — a tab switch re-mounts this layout.
    expect(screen.queryByText("Loading run…")).toBeNull();
    expect(screen.getByText("first-visit")).toBeInTheDocument();
    second.unmount();
  });

  // The behaviour the bound must not change. A run record is NOT immutable the
  // way a produced artifact is — a review can be added, an unpublished run can be
  // published — so the cached chrome is a head start, not the answer: the layout
  // refetches on every mount and replaces what it showed.
  it("still refetches behind the seeded chrome and replaces it", async () => {
    const runId = "cached-refresh";
    let variant = "stale";
    fixture.byId = (id: string) => detailFor(id, variant);
    const first = renderRun(runId);
    await screen.findByText("stale");
    first.unmount();

    variant = "fresh";
    const second = renderRun(runId);
    // The stale record paints first…
    expect(screen.getByText("stale")).toBeInTheDocument();
    // …and the background read that ran anyway replaces it.
    expect(await screen.findByText("fresh")).toBeInTheDocument();
    expect(fixture.calls.filter((id) => id === runId)).toHaveLength(2);
    second.unmount();
  });

  // The leak this closed. Twelve is the declared bound, so the thirteenth run
  // visited must push the first one out — and the one just visited must still be
  // held, or the cache would be bounded into uselessness.
  it("forgets the least recently visited run once past its bound", async () => {
    const ids = Array.from({ length: 13 }, (_, i) => `cache-walk-${i}`);
    fixture.byId = (id: string) => detailFor(id, `variant-${id}`);
    for (const id of ids) {
      const view = renderRun(id);
      await screen.findByText(`variant-${id}`);
      view.unmount();
    }

    // The first run walked past has been evicted: nothing to seed from, so the
    // layout is back to a full-body loading state on its first frame.
    const evicted = renderRun(ids[0]!);
    expect(screen.getByText("Loading run…")).toBeInTheDocument();
    evicted.unmount();

    // The most recent is still held and still paints immediately.
    const held = renderRun(ids[12]!);
    expect(screen.queryByText("Loading run…")).toBeNull();
    expect(screen.getByText(`variant-${ids[12]}`)).toBeInTheDocument();
    held.unmount();
  });
});
