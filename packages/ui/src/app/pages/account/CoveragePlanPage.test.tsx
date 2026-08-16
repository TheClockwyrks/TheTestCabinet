import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type {
  CoverageCell,
  CoverageMatrix,
  CoveragePlanSummary,
  CoverageQueue,
  TopUpResult,
} from "@test-cabinet/run-record/coverage";
import type { BackendClient } from "../../../client/clients";
import {
  sectionReturnLabel,
  sectionReturnTo,
  useRecordSectionIndex,
} from "../../components/backReturn";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import {
  MatrixSection,
  ReviewQueue,
  buildGroups,
  describeHalt,
  describeTopUp,
  planStatusNote,
  topUpAfterReview,
  type MatrixGroup,
} from "./CoveragePlanPage";

function galleryValue(): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

function cell(over: Partial<CoverageCell> = {}): CoverageCell {
  return {
    slug: "pong",
    version: "v1.0.0",
    variant: "base",
    harness: "claude",
    model: "claude-sonnet-4-5",
    desired: 3,
    completed: 1,
    inFlight: 0,
    pending: 0,
    unreviewed: 0,
    remaining: 2,
    latestVersion: "v1.0.0",
    stale: false,
    ...over,
  } as CoverageCell;
}

function matrix(
  cells: CoverageCell[],
  over: Partial<CoverageMatrix> = {},
): CoverageMatrix {
  return {
    cells,
    outerAxis: "case",
    cellsSatisfied: cells.filter((c) => c.remaining === 0).length,
    cellsTotal: cells.length,
    runsMissing: cells.reduce((n, c) => n + c.remaining, 0),
    runsPending: cells.reduce((n, c) => n + c.pending, 0),
    runsUnreviewed: cells.reduce((n, c) => n + c.unreviewed, 0),
    runsOutstanding: cells.reduce((n, c) => n + c.inFlight + c.unreviewed, 0),
    bufferTarget: 10,
    ...over,
  };
}

// The display name resolver a group build is handed; the tests care about grouping
// and order, not about the catalog, so the slug stands in for the name.
const nameOf = (slug: string) => slug;

function group(over: Partial<MatrixGroup> = {}): MatrixGroup {
  const c = cell();
  return {
    key: "pong@v1.0.0@base",
    title: "pong",
    subtitle: "base · v1.0.0",
    cells: [c],
    done: 1,
    desired: 3,
    pending: 0,
    unreviewed: 0,
    donePct: 33,
    flightPct: 0,
    ...over,
  };
}

function renderSection(over: Partial<MatrixGroup> = {}) {
  return render(
    <MemoryRouter>
      <GalleryDataProvider value={galleryValue()}>
        <MatrixSection
          group={group(over)}
          axis="case"
          busy={false}
          canTrigger
          onTrigger={vi.fn()}
        />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

// A block starts collapsed: its overall progress bar shows, but the per-cell rows
// are hidden until the reviewer expands it — the behavior the account Coverage tab
// relies on to keep a large plan scannable. Mirrors the Inputs/Changelog accordion.
describe("MatrixSection collapse", () => {
  it("starts collapsed: the toggle is not expanded and the rows are hidden", () => {
    renderSection();
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toBeTruthy();
    // The per-combination row (harness · model) is not rendered while collapsed.
    expect(screen.queryByText(/claude-sonnet-4-5/)).toBeNull();
    // The overall progress count is always visible.
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("expands to reveal the per-harness/model rows when toggled", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
    expect(screen.getByText(/claude-sonnet-4-5/)).toBeTruthy();
  });

  it("links each cell to the runs behind it, pinned to the cell's own version", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const link = screen.getByRole("link", { name: "Runs" });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("/runs?")).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(params.get("case")).toBe("pong");
    expect(params.get("version")).toBe("v1.0.0");
    expect(params.get("harness")).toBe("claude");
    expect(params.get("model")).toBe("claude-sonnet-4-5");
    // A pinned version must survive the listing's "current versions only" default,
    // or a deliberately-pinned older version's runs are filtered away.
    expect(params.get("latest")).toBe("0");
  });

  it("says how much of a cell is pending and how much awaits review", () => {
    renderSection({
      cells: [cell({ inFlight: 2, pending: 2, unreviewed: 1, remaining: 0 })],
    });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("2 pending")).toBeTruthy();
    // Both the block header's pill and the cell's own note say it.
    expect(screen.getAllByText(/1 to review/).length).toBeGreaterThan(0);
  });
});

// The dashboard is laid out on whichever axis the plan nests its cell loop on, in
// the order the backend emitted the cells — which, `queue_seq` being monotonic and
// the dispatcher claiming in ascending order, is the order the runs will arrive.
describe("buildGroups", () => {
  it("groups by case and keeps the plan's emission order, not alphabetical order", () => {
    const cells = [
      cell({ slug: "zeta", harness: "claude" }),
      cell({ slug: "zeta", harness: "codex" }),
      cell({ slug: "alpha", harness: "claude" }),
    ];
    const groups = buildGroups(matrix(cells), nameOf);
    expect(groups.map((g) => g.title)).toEqual(["zeta", "alpha"]);
    expect(groups[0]!.cells).toHaveLength(2);
    expect(groups[0]!.desired).toBe(6);
  });

  it("groups by harness/model when the plan runs one model at a time", () => {
    const cells = [
      cell({ slug: "alpha", harness: "codex", model: "gpt" }),
      cell({ slug: "zeta", harness: "codex", model: "gpt" }),
      cell({ slug: "alpha", harness: "claude", model: "opus" }),
    ];
    const groups = buildGroups(
      matrix(cells, { outerAxis: "combination" }),
      nameOf,
    );
    expect(groups.map((g) => g.title)).toEqual([
      "codex · gpt",
      "claude · opus",
    ]);
    expect(groups[0]!.cells.map((c) => c.slug)).toEqual(["alpha", "zeta"]);
  });

  it("rolls up the counts that explain an idle block", () => {
    const groups = buildGroups(
      matrix([
        cell({ completed: 3, inFlight: 1, pending: 1, unreviewed: 2 }),
        cell({ harness: "codex", completed: 0, inFlight: 0 }),
      ]),
      nameOf,
    );
    expect(groups[0]!.pending).toBe(1);
    expect(groups[0]!.unreviewed).toBe(2);
    expect(groups[0]!.done).toBe(4);
  });

  it("never overflows the bar when a cell has more runs than the target", () => {
    const groups = buildGroups(
      matrix([cell({ desired: 2, completed: 3, inFlight: 2, remaining: 0 })]),
      nameOf,
    );
    expect(groups[0]!.donePct).toBe(100);
    expect(groups[0]!.flightPct).toBe(0);
  });
});

// Every top-up outcome has to read differently: the reviewer's next move is
// "resume", "nothing", "review some", or "raise the target" respectively.
describe("describeTopUp", () => {
  function result(over: Partial<TopUpResult> = {}): TopUpResult {
    return { bufferTarget: 5, enqueued: 0, cells: [], ...over };
  }

  it("names a paused plan as paused rather than as idle", () => {
    expect(describeTopUp(result({ skipped: "paused" }))).toMatch(/paused/i);
  });

  it("says a concurrent top-up already ran, so nothing enqueued twice", () => {
    expect(describeTopUp(result({ skipped: "busy" }))).toMatch(/already/i);
  });

  it("reports what it enqueued, in runs and cells", () => {
    const message = describeTopUp(
      result({
        enqueued: 6,
        outstanding: 6,
        cells: [{ runs: 3 }, { runs: 3 }] as TopUpResult["cells"],
      }),
    );
    expect(message).toMatch(/6 runs/);
    expect(message).toMatch(/2 cells/);
  });

  it("tells a full buffer apart from a satisfied plan", () => {
    expect(describeTopUp(result({ outstanding: 5, bufferTarget: 5 }))).toMatch(
      /buffer is full/i,
    );
    expect(describeTopUp(result({ outstanding: 1, bufferTarget: 5 }))).toMatch(
      /every cell is at its target/i,
    );
  });
});

// A halt that only reports success cannot be told apart from a halt whose scope was
// wrong, so the count — including zero — is always stated.
describe("describeHalt", () => {
  it("reports the count and the scope", () => {
    expect(describeHalt({ canceled: 4, includedActive: false })).toMatch(
      /canceled 4 jobs that had not started/,
    );
    expect(describeHalt({ canceled: 1, includedActive: true })).toMatch(
      /canceled 1 job including runs already executing/,
    );
  });

  it("says explicitly that nothing was found rather than succeeding silently", () => {
    expect(describeHalt({ canceled: 0, includedActive: false })).toMatch(
      /no jobs of this plan were waiting/i,
    );
  });
});

// An idle plan is the most confusing state the page can be in, so each cause
// explains itself and points at its own remedy.
describe("planStatusNote", () => {
  it("explains a pause before anything else", () => {
    const note = planStatusNote(matrix([cell()]), true);
    expect(note).toMatch(/paused/i);
    expect(note).toMatch(/already queued is untouched/i);
  });

  it("explains a full review buffer as waiting on you", () => {
    const note = planStatusNote(
      matrix([cell({ inFlight: 1, unreviewed: 4 })], { bufferTarget: 5 }),
      false,
    );
    expect(note).toMatch(/5 of 5/);
    expect(note).toMatch(/review some/i);
  });

  it("says a satisfied plan was satisfied partly by runs you have not reviewed", () => {
    const note = planStatusNote(
      matrix([cell({ completed: 3, remaining: 0, unreviewed: 2 })]),
      false,
    );
    expect(note).toMatch(/every cell is at its target/i);
    expect(note).toMatch(/2 runs you have not reviewed/);
  });

  it("distinguishes pending from stuck", () => {
    const note = planStatusNote(
      matrix([cell({ inFlight: 2, pending: 2, remaining: 0, completed: 1 })]),
      false,
    );
    expect(note).toMatch(/held back by the queue/i);
    expect(note).toMatch(/not stuck/i);
  });

  it("stays quiet when there is nothing to explain", () => {
    expect(planStatusNote(matrix([cell()]), false)).toBeNull();
  });
});

// The queue is the review loop's list: it must open runs in the plan's own order and
// leave a back-return behind it, so reviewing walks the buffer and lands back on the
// plan rather than on the runs index.
describe("ReviewQueue", () => {
  function queue(): CoverageQueue {
    return {
      runs: [
        {
          runId: "r1",
          slug: "zeta",
          version: "v1.0.0",
          variant: "base",
          harness: "claude",
          model: "opus",
          finishedAt: "2026-08-15T00:00:00Z",
        },
        {
          runId: "r2",
          slug: "alpha",
          version: "v1.0.0",
          variant: "base",
          harness: "codex",
          model: "gpt",
          finishedAt: "2026-08-15T00:01:00Z",
        },
      ],
      truncated: false,
    };
  }

  // Stands in for the dashboard, which records itself as the coverage section's
  // index as it renders.
  function Dashboard() {
    useRecordSectionIndex("coverage");
    return <ReviewQueue queue={queue()} />;
  }

  it("keeps the plan's order rather than sorting the runs", () => {
    render(
      <MemoryRouter initialEntries={["/account/coverage/p1"]}>
        <GalleryDataProvider value={galleryValue()}>
          <ReviewQueue queue={queue()} />
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link");
    // Emission order, not newest-first and not alphabetical (the catalog resolver
    // title-cases a slug it does not know).
    expect(links.map((l) => l.textContent)).toEqual(["Zeta", "Alpha"]);
    expect(links[0]!.getAttribute("href")).toBe("/runs/r1");
  });

  it("hands the run's back control a return to the plan it was opened from", () => {
    // Routed, so the dashboard unmounts on navigation exactly as it does in the
    // app — a still-mounted index would re-record itself at the run's URL.
    render(
      <MemoryRouter initialEntries={["/account/coverage/p1"]}>
        <GalleryDataProvider value={galleryValue()}>
          <Routes>
            <Route path="/account/coverage/:planId" element={<Dashboard />} />
            <Route path="/runs/:runId" element={<p>a run</p>} />
          </Routes>
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    // Before the click, a run's back control is the runs section's own default.
    expect(sectionReturnTo("runs", "/runs")).toBe("/runs");
    fireEvent.click(screen.getAllByRole("link")[0]!);
    expect(screen.getByText("a run")).toBeTruthy();
    expect(sectionReturnTo("runs", "/runs")).toBe("/account/coverage/p1");
  });

  // The run page's back control labels itself "All runs". Once a claim has pointed it
  // at a dashboard instead, that label is simply untrue — and it is the only thing an
  // icon-only chevron says to a screen reader, so the claim carries its own wording.
  it("renames the run's back control to the dashboard it now returns to", () => {
    function LadderDashboard() {
      useRecordSectionIndex("coverage");
      return <ReviewQueue queue={queue()} returnLabel="Back to the ladder" />;
    }
    render(
      <MemoryRouter initialEntries={["/account/ladders/l1"]}>
        <GalleryDataProvider value={galleryValue()}>
          <Routes>
            <Route
              path="/account/ladders/:ladderId"
              element={<LadderDashboard />}
            />
            <Route path="/runs/:runId" element={<p>a run</p>} />
          </Routes>
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    expect(sectionReturnLabel("runs", "All runs")).toBe("All runs");
    fireEvent.click(screen.getAllByRole("link")[0]!);
    expect(sectionReturnTo("runs", "/runs")).toBe("/account/ladders/l1");
    expect(sectionReturnLabel("runs", "All runs")).toBe("Back to the ladder");
    // A page with no section is one whose parent list is fixed — the dashboard's own
    // "all ladders" chevron — and must never be redirected or relabelled.
    expect(sectionReturnLabel(undefined, "All ladders")).toBe("All ladders");
  });
});

// A review landing is the moment that frees a buffer slot, and the only other thing
// besides opening a plan that can refill one — but only for plans that asked.
describe("topUpAfterReview", () => {
  function summary(over: Partial<CoveragePlanSummary>): CoveragePlanSummary {
    return {
      id: "p1",
      name: "plan",
      runsPerCell: 3,
      cellsSatisfied: 0,
      cellsTotal: 1,
      runsMissing: 3,
      runsUnreviewed: 0,
      paused: false,
      autoTopUp: false,
      ...over,
    };
  }

  function backend(plans: CoveragePlanSummary[], topUp = vi.fn()) {
    return {
      getCoveragePlansSummary: async () => plans,
      topUpCoveragePlan: async (id: string) => {
        topUp(id);
        return { bufferTarget: 5, enqueued: 2, cells: [] } as TopUpResult;
      },
    } as unknown as BackendClient;
  }

  it("tops up only the plans that opted in and are not paused", async () => {
    const topUp = vi.fn();
    const enqueued = await topUpAfterReview(
      backend(
        [
          summary({ id: "on", autoTopUp: true }),
          summary({ id: "off", autoTopUp: false }),
          summary({ id: "paused", autoTopUp: true, paused: true }),
        ],
        topUp,
      ),
      "token",
    );
    expect(topUp.mock.calls.map((c) => c[0])).toEqual(["on"]);
    expect(enqueued).toBe(2);
  });

  it("stays silent when it cannot run, so a review never fails because of it", async () => {
    await expect(topUpAfterReview(null, "token")).resolves.toBe(0);
    await expect(
      topUpAfterReview(
        {
          getCoveragePlansSummary: async () => {
            throw new Error("backend down");
          },
          topUpCoveragePlan: async () => ({}) as TopUpResult,
        } as unknown as BackendClient,
        "token",
      ),
    ).resolves.toBe(0);
  });
});
