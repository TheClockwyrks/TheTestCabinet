import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CoverageCell,
  CoverageMatrix,
  CoveragePlanSummary,
  CoverageQueue,
  TopUpBlocked,
  TopUpResult,
} from "@test-cabinet/run-record/coverage";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import type { BackendClient, WorkerClient } from "../../../client/clients";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkersContextValue,
} from "../../../client/context";
import type { GgConfigOption } from "../runs/gg/useGgConfigs";
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
  CoveragePlanPage,
  MatrixSection,
  ReviewQueue,
  buildGroups,
  cellKey,
  describeHalt,
  describeTopUp,
  ggTriggerReadiness,
  itemsForCells,
  launchGgCells,
  planGgLaunches,
  planStatusNote,
  topUpAfterReview,
  unresolvedGgProblem,
  type MatrixGroup,
} from "./CoveragePlanPage";

// The page's app chrome reads contexts (gallery data, notifications) that none of
// these tests are about; stub it as the other account page tests do.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// A signed-in operator: a coverage plan and the gg configurations behind its cells
// both belong to an account.
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));
// The account's gg configurations and, crucially, whether they have arrived — the
// distinction between "you have none", "not yet" and "the request failed", which the
// page has to keep apart because the three resolve a gg cell identically.
let ggState: {
  options: GgConfigOption[];
  loading: boolean;
  error: string | null;
} = { options: [], loading: false, error: null };
vi.mock("../runs/gg/useGgConfigs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../runs/gg/useGgConfigs")>();
  return {
    ...actual,
    useGgConfigs: () => ({
      options: ggState.options,
      saved: [],
      loading: ggState.loading,
      error: ggState.error,
      reload: async () => {},
    }),
  };
});

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

// A gg cell: the same case, executed by a saved configuration with a model bound to
// each launch slot it declares, rather than by a harness and a model id.
function ggCell(over: Partial<CoverageCell> = {}): CoverageCell {
  return cell({
    harness: "gg",
    model: "opus",
    ggConfigId: "saved:cfg-1",
    ggConfigName: "reviewer",
    ggSlotModels: { primary: "opus", critic: "haiku" },
    ...over,
  });
}

// The two-slot configuration the gg cells above name: a root agent and a critic, each
// deferring its model to a configuration-level launch slot. Enough of a set for
// `bindModelSlots` to have something real to bind.
const REVIEWER_SET: GgCapabilitySet = {
  preset: "reviewer",
  // Stamped onto every offered configuration by `useGgConfigs`, and what a launched
  // run is attributed to.
  presetId: "cfg-1",
  modelSlots: [
    { name: "primary", targets: [{ agent: "a-root", slot: "own" }] },
    { name: "critic", targets: [{ agent: "a-critic", slot: "own" }] },
  ],
  agents: [
    {
      id: "a-root",
      slug: "root",
      name: "Root",
      capabilities: [],
      modelId: "",
      modelSlot: "own",
      modelSlots: [{ name: "own" }],
      openingTurn: { modules: [], functions: [] },
    },
    {
      id: "a-critic",
      slug: "critic",
      name: "Critic",
      capabilities: [],
      modelId: "",
      modelSlot: "own",
      modelSlots: [{ name: "own" }],
      openingTurn: { modules: [], functions: [] },
    },
  ],
};

function ggOption(over: Partial<GgConfigOption> = {}): GgConfigOption {
  return {
    key: "saved:cfg-1",
    name: "reviewer",
    description: "",
    capabilitySet: REVIEWER_SET,
    ...over,
  } as GgConfigOption;
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

  it("names a cell's engine on a combination-grouped block", () => {
    // The block has already said which combination it is, so the row is the pin — and
    // two rows of one case on two engines are otherwise the same line of text.
    render(
      <MemoryRouter>
        <GalleryDataProvider value={galleryValue()}>
          <MatrixSection
            group={group({
              cells: [cell({ engine: "simple-2d" }), cell()],
            })}
            axis="combination"
            busy={false}
            canTrigger
            onTrigger={vi.fn()}
          />
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Carom · base · v1.0.0 · Simple 2D")).toBeTruthy();
    // The engineless row keeps the label it always had.
    expect(screen.getByText("Carom · base · v1.0.0")).toBeTruthy();
  });

  it("labels a gg cell by its configuration and the models it binds", () => {
    renderSection({ cells: [ggCell()] });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    // Not "gg · opus": the configuration is what the reviewer chose, and the models
    // are what tells two arms of it apart.
    expect(screen.getByText("reviewer · haiku, opus")).toBeTruthy();
  });

  it("narrows a gg cell's runs link by the configuration's id", () => {
    renderSection({ cells: [ggCell()] });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const href = screen
      .getByRole("link", { name: "Runs" })
      .getAttribute("href");
    const params = new URLSearchParams(href!.slice(href!.indexOf("?")));
    expect(params.get("harness")).toBe("gg");
    // The bare id the run records, never the picker's `saved:` spelling, and never
    // the name: the cell counts by this id, so the listing behind the figure has to
    // select on the same value.
    expect(params.get("ggConfigId")).toBe("cfg-1");
    expect(params.get("q")).toBeNull();
  });

  it("shows why a blocked cell cannot be launched, and refuses to trigger it", () => {
    const onTrigger = vi.fn();
    render(
      <MemoryRouter>
        <GalleryDataProvider value={galleryValue()}>
          <MatrixSection
            group={group({
              cells: [
                ggCell({
                  unlaunchable: "launch slot `critic` is unbound",
                }),
              ],
            })}
            axis="case"
            busy={false}
            canTrigger
            onTrigger={onTrigger}
          />
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("launch slot `critic` is unbound")).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "Blocked" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
    expect(onTrigger).not.toHaveBeenCalled();
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

  it("keeps two gg configurations apart even when their root model agrees", () => {
    const cells = [
      ggCell({ slug: "alpha", ggConfigId: "saved:a", ggConfigName: "solo" }),
      ggCell({ slug: "alpha", ggConfigId: "saved:b", ggConfigName: "duo" }),
    ];
    const groups = buildGroups(
      matrix(cells, { outerAxis: "combination" }),
      nameOf,
    );
    expect(groups).toHaveLength(2);
    // A gg block is titled by its configuration and the models it binds, never by
    // "gg · <root model>" — which is the same string for both of these.
    expect(groups.map((g) => g.title)).toEqual([
      "solo · haiku, opus",
      "duo · haiku, opus",
    ]);
  });

  it("names the engine in a case block's subtitle only when one is named", () => {
    const plain = buildGroups(matrix([cell()]), nameOf);
    // `none` is the ordinary case and every pin has an engine, so spelling it out
    // would add a word to every block on the page and distinguish nothing.
    expect(plain[0]!.subtitle).toBe("base · v1.0.0");
    const engined = buildGroups(matrix([cell({ engine: "simple-2d" })]), nameOf);
    expect(engined[0]!.subtitle).toBe("base · v1.0.0 · Simple 2D");
  });

  it("splits one case's two engines into two blocks", () => {
    const groups = buildGroups(
      matrix([cell({ engine: "none" }), cell({ engine: "simple-2d" })]),
      nameOf,
    );
    // Two pins, whose runs are not comparable — rolled into one block the heading
    // would describe neither, and the progress bar would sum two targets.
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.subtitle)).toEqual([
      "base · v1.0.0",
      "base · v1.0.0 · Simple 2D",
    ]);
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

// A gg cell is identified by its configuration and the models it binds, never by the
// root model alone — one configuration run against three models is three cells whose
// case, harness, and root model all agree.
describe("cellKey", () => {
  it("keeps a harness cell's key free of any gg segment", () => {
    expect(cellKey(cell())).toBe(
      "pong@v1.0.0@base@none::claude::claude-sonnet-4-5::",
    );
  });

  it("separates two cells of one pin that differ only on engine", () => {
    // The same case, version, variant, harness and model on two engines is two cells
    // the server counts separately; one React key for both renders one row.
    expect(cellKey(cell({ engine: "simple-2d" }))).not.toBe(
      cellKey(cell({ engine: "structured-2d" })),
    );
  });

  it("keys a cell pinned to no engine as the engineless one", () => {
    // Absent and `none` are the same pin, so a plan authored before the pin carried an
    // engine and one that names `none` explicitly must land in a single cell.
    expect(cellKey(cell({ engine: "none" }))).toBe(cellKey(cell()));
  });

  it("separates two gg cells of one configuration that bind different models", () => {
    const a = ggCell({ ggSlotModels: { primary: "opus", critic: "haiku" } });
    const b = ggCell({ ggSlotModels: { primary: "opus", critic: "sonnet" } });
    expect(cellKey(a)).not.toBe(cellKey(b));
  });

  it("separates two configurations whose runs share a root model", () => {
    const a = ggCell({ ggConfigId: "saved:a", ggConfigName: "solo" });
    const b = ggCell({ ggConfigId: "saved:b", ggConfigName: "duo" });
    expect(cellKey(a)).not.toBe(cellKey(b));
  });

  it("separates two configurations an account gave one name", () => {
    // Nothing makes a configuration's name unique within an account, and the server counts
    // two that share one as two cells. A key built from the name would hand React one key
    // for both, rendering one row and silently dropping the other.
    const a = ggCell({ ggConfigId: "cfg-a", ggConfigName: "planning-A" });
    const b = ggCell({ ggConfigId: "cfg-b", ggConfigName: "planning-A" });
    expect(cellKey(a)).not.toBe(cellKey(b));
  });

  it("keys a configuration the same however the member spelled its id", () => {
    const picker = ggCell({
      ggConfigId: "saved:cfg-a",
      ggConfigName: "planning-A",
    });
    const bare = ggCell({ ggConfigId: "cfg-a", ggConfigName: "planning-A" });
    expect(cellKey(picker)).toBe(cellKey(bare));
  });

  it("does not depend on the order the slot bindings arrived in", () => {
    const a = ggCell({ ggSlotModels: { primary: "opus", critic: "haiku" } });
    const b = ggCell({ ggSlotModels: { critic: "haiku", primary: "opus" } });
    expect(cellKey(a)).toBe(cellKey(b));
  });
});

// The two shapes a combination takes go out on two different endpoints, so the split
// has to happen before either is called — and a cell nothing can launch goes on
// neither.
describe("itemsForCells", () => {
  it("builds one launch per missing run, and leaves gg cells alone", () => {
    const items = itemsForCells([cell({ remaining: 2 }), ggCell()]);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.config.harness === "claude")).toBe(true);
  });

  it("launches each run on the cell's own engine", () => {
    // The engine is a segment of the cell's identity, so a run launched engineless
    // from a cell pinned to a runtime is counted against another cell — leaving the
    // one that asked for it short by exactly the run just paid for.
    const [item] = itemsForCells([cell({ engine: "simple-2d", remaining: 1 })]);
    expect(item!.config.engine).toBe("simple-2d");
    // And tracked on it, so the in-flight row sits with the cell it was launched for.
    expect(item!.track.engine).toBe("simple-2d");
  });

  it("names the engineless run rather than leaving the engine unsaid", () => {
    const [item] = itemsForCells([cell({ engine: "none", remaining: 1 })]);
    expect(item!.config.engine).toBe("none");
  });

  it("skips a cell the matrix said cannot be launched", () => {
    expect(
      itemsForCells([
        cell({ unlaunchable: "no context window for that model" }),
      ]),
    ).toEqual([]);
  });
});

describe("planGgLaunches", () => {
  it("binds the cell's models onto the configuration's launch slots", () => {
    const { launches } = planGgLaunches(
      [ggCell({ remaining: 1 })],
      [ggOption()],
    );
    expect(launches).toHaveLength(1);
    const agents = launches[0]!.capabilitySet.agents;
    expect(agents.map((a) => a.modelId)).toEqual(["opus", "haiku"]);
    // The declarations are consumed by the binding: what runs pins models and names
    // no slot at either level.
    expect(agents.every((a) => !a.modelSlot && !a.modelSlots)).toBe(true);
    expect(launches[0]!.capabilitySet.modelSlots).toBeUndefined();
  });

  // The binding rebuilds the set, and a run that lost the id on the way through would
  // be attributed to no configuration at all — the cell the reviewer pressed would
  // still read as missing that run, and the next top-up would buy it again.
  it("carries the configuration's id through the binding, which is what the cell is keyed on", () => {
    const { launches } = planGgLaunches(
      [ggCell({ remaining: 1 })],
      [ggOption()],
    );
    expect(launches[0]!.capabilitySet.presetId).toBe("cfg-1");
  });

  it("emits a cell's repeats together, so they arrive adjacent", () => {
    const { launches } = planGgLaunches(
      [ggCell({ remaining: 3 })],
      [ggOption()],
    );
    expect(launches).toHaveLength(3);
    expect(launches.every((l) => l.cell.slug === "pong")).toBe(true);
  });

  it("resolves a member that stored the bare id rather than the saved key", () => {
    const { launches, unresolved } = planGgLaunches(
      [ggCell({ ggConfigId: "cfg-1", remaining: 1 })],
      [ggOption()],
    );
    expect(unresolved).toEqual([]);
    expect(launches).toHaveLength(1);
  });

  it("reports a configuration it cannot resolve rather than quietly launching fewer", () => {
    const { launches, unresolved } = planGgLaunches(
      [ggCell({ ggConfigId: "saved:gone" })],
      [ggOption()],
    );
    expect(launches).toEqual([]);
    expect(unresolved).toHaveLength(1);
  });

  it("skips a cell the matrix already said cannot be launched, and every harness cell", () => {
    const { launches, unresolved } = planGgLaunches(
      [cell(), ggCell({ unlaunchable: "launch slot `critic` is unbound" })],
      [ggOption()],
    );
    expect(launches).toEqual([]);
    expect(unresolved).toEqual([]);
  });
});

// gg has no batch endpoint, so the fan-out is one request per run — and one refused
// configuration must not take the rest of the trigger with it.
describe("launchGgCells", () => {
  function worker(launchGgRun: WorkerClient["launchGgRun"]) {
    return { client: { launchGgRun } as unknown as WorkerClient };
  }

  it("enqueues one run per launch and tracks each as queued", async () => {
    const launchGgRun = vi.fn().mockResolvedValue({ jobId: "job-1" });
    const track = vi.fn();
    const { launches } = planGgLaunches(
      [ggCell({ remaining: 2 })],
      [ggOption()],
    );
    const failed = await launchGgCells(
      worker(launchGgRun),
      "token",
      track,
      launches,
    );
    expect(failed).toEqual([]);
    expect(launchGgRun).toHaveBeenCalledTimes(2);
    const request = launchGgRun.mock.calls[0]![0];
    expect(request.testCase).toBe("pong");
    expect(request.version).toBe("v1.0.0");
    expect(request.variant).toBe("base");
    // Submitted with the configuration's id, so the run counts against the cell it was
    // triggered from rather than against no configuration.
    expect(request.capabilitySet.presetId).toBe("cfg-1");
    expect(track).toHaveBeenCalledTimes(2);
    // Tracked under the identity the backend will lift back out of the job: gg, the
    // root agent's bound model, and the configuration's name.
    expect(track.mock.calls[0]![0]).toMatchObject({
      harnessSlug: "gg",
      modelId: "opus",
      ggPreset: "reviewer",
      runId: "job-1",
      state: "queued",
    });
  });

  it("launches a gg cell on the cell's own engine", async () => {
    // A gg run seeds and builds a workspace like any other run, and the plan's own
    // top-up sends the cell's engine. The by-hand trigger sending nothing would put
    // the two paths' runs in two different cells for one press of one button.
    const launchGgRun = vi.fn().mockResolvedValue({ jobId: "job-1" });
    const { launches } = planGgLaunches(
      [ggCell({ remaining: 1, engine: "structured-2d" })],
      [ggOption()],
    );
    await launchGgCells(worker(launchGgRun), "token", vi.fn(), launches);
    expect(launchGgRun.mock.calls[0]![0].engine).toBe("structured-2d");
  });

  it("isolates a failure so the rest of the trigger still goes out", async () => {
    const launchGgRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("nope"))
      .mockResolvedValue({ jobId: "job-2" });
    const track = vi.fn();
    const { launches } = planGgLaunches(
      [ggCell({ remaining: 2 })],
      [ggOption()],
    );
    const failed = await launchGgCells(
      worker(launchGgRun),
      "token",
      track,
      launches,
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toBe("nope");
    expect(track).toHaveBeenCalledTimes(1);
  });
});

// Every top-up outcome has to read differently: the reviewer's next move is
// "resume", "nothing", "review some", or "raise the target" respectively.
describe("describeTopUp", () => {
  function result(over: Partial<TopUpResult> = {}): TopUpResult {
    return {
      bufferTarget: 5,
      enqueued: 0,
      cells: [],
      unlaunchable: [],
      ...over,
    };
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

  it("reports the cells it could not launch beside the ones it did", () => {
    const blocked = [
      { reason: "gg configuration `reviewer` no longer exists" },
      { reason: "launch slot `critic` is unbound" },
    ] as TopUpBlocked[];
    const message = describeTopUp(
      result({
        enqueued: 3,
        cells: [{ runs: 3 }] as TopUpResult["cells"],
        unlaunchable: blocked,
      }),
    );
    // Both halves: one broken member never stops the rest of a plan being fed.
    expect(message).toMatch(/Enqueued 3 runs/);
    expect(message).toMatch(/2 cells could not be launched/);
    expect(message).toMatch(/no longer exists/);
  });

  it("does not call a plan satisfied when its shortfall is unlaunchable", () => {
    const message = describeTopUp(
      result({
        outstanding: 1,
        bufferTarget: 5,
        unlaunchable: [
          { reason: "launch slot `critic` is unbound" },
        ] as TopUpBlocked[],
      }),
    );
    expect(message).not.toMatch(/every cell is at its target/i);
    expect(message).toMatch(/1 cell could not be launched/);
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

  it("names the cells nothing can launch, which no other count explains", () => {
    const note = planStatusNote(
      matrix([
        cell(),
        ggCell({
          unlaunchable: "gg configuration `reviewer` no longer exists",
        }),
      ]),
      false,
    );
    expect(note).toMatch(/1 cell cannot be launched at all/);
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
          engine: "none",
          harness: "claude",
          model: "opus",
          finishedAt: "2026-08-15T00:00:00Z",
        },
        {
          runId: "r2",
          slug: "alpha",
          version: "v1.0.0",
          variant: "base",
          engine: "none",
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

  it("names a queued run's engine, so two pins do not read alike", () => {
    render(
      <MemoryRouter initialEntries={["/account/coverage/p1"]}>
        <GalleryDataProvider value={galleryValue()}>
          <ReviewQueue
            queue={{
              runs: [
                {
                  runId: "r1",
                  slug: "zeta",
                  version: "v1.0.0",
                  variant: "base",
                  engine: "simple-2d",
                  harness: "claude",
                  model: "opus",
                  finishedAt: "2026-08-15T00:00:00Z",
                },
              ],
              truncated: false,
            }}
          />
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("base · v1.0.0 · Simple 2D")).toBeTruthy();
  });

  it("leaves the engineless run unnamed, as every other surface does", () => {
    render(
      <MemoryRouter initialEntries={["/account/coverage/p1"]}>
        <GalleryDataProvider value={galleryValue()}>
          <ReviewQueue queue={queue()} />
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    expect(screen.getAllByText("base · v1.0.0")).toHaveLength(2);
  });

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
    // The queue is a review worklist, so its rows deep-link to the run's
    // Verdict tab rather than the Play landing tab.
    expect(links[0]!.getAttribute("href")).toBe("/runs/r1/verdict");
  });

  it("hands the run's back control a return to the plan it was opened from", () => {
    // Routed, so the dashboard unmounts on navigation exactly as it does in the
    // app — a still-mounted index would re-record itself at the run's URL.
    render(
      <MemoryRouter initialEntries={["/account/coverage/p1"]}>
        <GalleryDataProvider value={galleryValue()}>
          <Routes>
            <Route path="/account/coverage/:planId" element={<Dashboard />} />
            <Route path="/runs/:runId/verdict" element={<p>a run</p>} />
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
        return {
          bufferTarget: 5,
          enqueued: 2,
          cells: [],
          unlaunchable: [],
        } as TopUpResult;
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

// Triggering a gg cell by hand needs the capability set behind its configuration, so
// the state of that load is part of whether the controls can be pressed at all — and
// "we could not fetch them" must never be reported as "you do not have them".
describe("ggTriggerReadiness", () => {
  it("holds the controls back until the configurations are in hand", () => {
    expect(ggTriggerReadiness(true, null).ready).toBe(false);
    expect(ggTriggerReadiness(false, null).ready).toBe(true);
  });

  it("says a load failure out loud, and names it as a load failure", () => {
    const { notice } = ggTriggerReadiness(false, "Error: 503");
    expect(notice).toMatch(/could not be loaded/i);
    expect(notice).toMatch(/503/);
    // Never a claim about what the account holds.
    expect(notice).not.toMatch(/no saved|none saved|have no/i);
  });

  it("leaves the harness half of a plan launchable when the load failed", () => {
    // The failure is in one lookup, not in the worker or the plan: a plan of harness
    // cells has nothing to wait for.
    expect(ggTriggerReadiness(false, "Error: 503").ready).toBe(true);
  });

  it("stays quiet when there is nothing wrong", () => {
    expect(ggTriggerReadiness(false, null).notice).toBeNull();
    // Loading is transient and gates the press by itself; a notice for it would flash
    // on every visit.
    expect(ggTriggerReadiness(true, null).notice).toBeNull();
  });
});

// The sentence an operator is likeliest to believe about their own data, so it has to
// be earned: a configuration is "gone" only when the list it is missing from actually
// arrived.
describe("unresolvedGgProblem", () => {
  it("reports a deletion only when the configurations were loaded", () => {
    expect(unresolvedGgProblem(ggCell(), null)).toMatch(
      /no longer on your account/,
    );
  });

  it("blames the load, not the operator, when the list never arrived", () => {
    const said = unresolvedGgProblem(ggCell(), "Error: 503");
    expect(said).toMatch(/could not be loaded/i);
    expect(said).not.toMatch(/no longer on your account/);
    // Still names which cell, or a mixed trigger's report cannot be acted on.
    expect(said).toMatch(/reviewer/);
  });
});

// The dashboard mounted for real, which is what the whole-page tests below need: a
// signed-in account, one worker, and a plan whose matrix is whatever the test hands in.
const worker = {
  id: "w1",
  local: true,
  client: { launchJobs: vi.fn() } as unknown as WorkerClient,
};

function backendValue(cells: CoverageCell[]): BackendContextValue {
  return {
    client: {
      getCoveragePlanCoverage: async () => matrix(cells),
      getCoveragePlanQueue: async () =>
        ({ runs: [], truncated: false }) as CoverageQueue,
      listCoveragePlans: async () => [
        {
          id: "p1",
          name: "plan",
          runsPerCell: 3,
          comboGroupIds: [],
          caseGroupIds: [],
          combos: [],
          cases: [],
          updatedAt: "2026-08-15T00:00:00Z",
          outerAxis: "case",
          paused: false,
          autoTopUp: false,
        },
      ],
      topUpCoveragePlan: async () =>
        ({
          bufferTarget: 10,
          enqueued: 0,
          cells: [],
          unlaunchable: [],
        }) as TopUpResult,
    } as unknown as BackendClient,
    identity: null,
    status: "ready",
    error: null,
    url: "http://backend",
    setUrl: vi.fn(),
  };
}

function workersValue(): WorkersContextValue {
  return {
    workers: [worker],
    activeId: "w1",
    active: worker,
    setActive: vi.fn(),
    addWorker: vi.fn(),
    removeWorker: vi.fn(),
  } as unknown as WorkersContextValue;
}

function renderPlanPage(cells: CoverageCell[]) {
  render(
    <MemoryRouter initialEntries={["/account/coverage/p1"]}>
      <BackendProvider value={backendValue(cells)}>
        <WorkersProvider value={workersValue()}>
          <GalleryDataProvider value={galleryValue()}>
            <Routes>
              <Route
                path="/account/coverage/:planId"
                element={<CoveragePlanPage />}
              />
            </Routes>
          </GalleryDataProvider>
        </WorkersProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
}

// The dashboard's one decision about its controls: which are live, given a worker and
// the state of the account's gg configurations.
describe("CoveragePlanPage triggers", () => {
  async function renderPage() {
    renderPlanPage([cell(), ggCell()]);
    return await screen.findByRole("button", { name: "Trigger all missing" });
  }

  beforeEach(() => {
    ggState = { options: [ggOption()], loading: false, error: null };
  });

  it("refuses to trigger until the gg configurations have loaded", async () => {
    ggState = { options: [], loading: true, error: null };
    const trigger = await renderPage();
    // Pressed a moment earlier, every gg cell resolves to nothing and is reported as
    // deleted — while the harness cells of the same press launch normally.
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    // And not because of the worker: that has its own notice, and claiming one is
    // missing would send the operator to fix something that is already fine.
    expect(screen.queryByText(/No worker connected/)).toBeNull();
  });

  it("lets the trigger through once they have", async () => {
    const trigger = await renderPage();
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
  });

  it("says the configurations could not be loaded rather than showing nothing", async () => {
    ggState = { options: [], loading: false, error: "Error: 503" };
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(/could not be loaded/i)).toBeTruthy(),
    );
  });
});

// A plan with nothing in it is where an operator is told what a plan holds, and it is
// the last screen before the picker that offers gg. The Plans list and the Groups tab
// say both shapes; a dashboard that still said harness+model would contradict them at
// the point the operator acts.
describe("CoveragePlanPage empty state", () => {
  beforeEach(() => {
    ggState = { options: [ggOption()], loading: false, error: null };
  });

  it("names both shapes a combination takes, not harness and model alone", async () => {
    renderPlanPage([]);
    const said = (await screen.findByText(/This plan is empty/)).textContent;
    expect(said).toMatch(/gg configuration/);
    expect(said).not.toMatch(/harness\/model/);
  });
});
