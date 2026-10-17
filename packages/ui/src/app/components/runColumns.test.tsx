import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ArtifactStorageStatus } from "@clockwyrks/run-record/jobs-api";
import type { InProgressRun } from "../../client/types";
import { useArtifactStorage } from "../runtime/artifactStorage";
import { formatTimestamp } from "../format";
import {
  RUN_COLUMNS,
  type RunColumn,
  type RunRenderContext,
} from "./runColumns";

const activeRun: InProgressRun = {
  runId: "r-1",
  testCaseSlug: "carom",
  testCaseVersion: "v1.2.0",
  variant: "base",
  harnessSlug: "claude",
  modelId: "claude-opus-4-8",
  state: "running",
};

// When a run reports it started — the moment the driver announced `starting`.
const STARTED_AT = "2026-01-05T00:00:00Z";

// The same run, started: what the job stamps once it is no longer merely queued.
const startedRun: InProgressRun = { ...activeRun, startedAt: STARTED_AT };

// A run that has not started at all: still waiting behind the queue, so it has no
// start and no elapsed time — only the phase it is holding in.
const queuedRun: InProgressRun = { ...activeRun, state: "queued" };

function column(id: string): RunColumn {
  const col = RUN_COLUMNS.find((c) => c.id === id);
  if (!col) throw new Error(`no column ${id}`);
  return col;
}

function ctx(overrides: Partial<RunRenderContext> = {}): RunRenderContext {
  return {
    visible: new Set(),
    testCaseName: (slug) => slug,
    testCaseType: () => "end-to-end",
    modelName: (modelId) => modelId,
    now: Date.parse(STARTED_AT),
    ...overrides,
  };
}

// Columns that don't depend on the run result must fill their in-progress cell
// (not dash), since the values are known from the launch identity / catalog.
describe("run column in-progress cells", () => {
  it("shows the launched version for an in-progress run", () => {
    const { container } = render(
      column("version").renderActive(activeRun, ctx()),
    );
    expect(container.textContent).toBe("v1.2.0");
  });

  it("resolves the category from the catalog for an in-progress run", () => {
    const { container } = render(
      column("category").renderActive(activeRun, ctx()),
    );
    expect(container.textContent).toBe("End-to-end");
  });

  it("dashes the category only when the catalog doesn't know the case", () => {
    const { container } = render(
      column("category").renderActive(
        activeRun,
        ctx({ testCaseType: () => null }),
      ),
    );
    expect(container.textContent).toBe("—");
  });

  it("shows the model for an in-progress third-party-harness run", () => {
    const { container } = render(
      column("model").renderActive(activeRun, ctx()),
    );
    expect(container.textContent).toBe("claude-opus-4-8");
  });

  it("shows the configuration for an in-progress gg run", () => {
    // A gg run binds a model per agent, so its configuration — not the
    // representative primary-slot model — is what names the row.
    const { container } = render(
      column("model").renderActive(
        { ...activeRun, harnessSlug: "gg", ggPreset: "planning-A" },
        ctx(),
      ),
    );
    expect(container.textContent).toBe("planning-A");
  });

  it("falls back to the model for a gg run with no configuration name", () => {
    const { container } = render(
      column("model").renderActive({ ...activeRun, harnessSlug: "gg" }, ctx()),
    );
    expect(container.textContent).toBe("claude-opus-4-8");
  });

  it("shows the engine an in-progress run was launched on", () => {
    // The engine is fixed at launch and lifted onto the job, so the live row names
    // it exactly as the finished row will.
    const { container } = render(
      column("engine").renderActive(
        { ...activeRun, engine: "simple-2d" },
        ctx(),
      ),
    );
    expect(container.textContent).toBe("simple-2d");
  });

  it("reads a run that named no engine as the engineless one, not a dash", () => {
    // Absent, empty and `none` are one engine — the engineless run every case
    // supports — so the cell resolves rather than dashing a run whose engine is
    // perfectly well known.
    for (const engine of [undefined, null, ""]) {
      const { container } = render(
        column("engine").renderActive({ ...activeRun, engine }, ctx()),
      );
      expect(container.textContent).toBe("none");
    }
  });

  it("shows when a started run started", () => {
    const { container } = render(
      column("timestamp").renderActive(startedRun, ctx()),
    );
    expect(container.textContent).toBe(formatTimestamp(STARTED_AT));
  });

  it("dashes the start of a run that has not started yet", () => {
    // Honest rather than missing: a queued run has no start, and its enqueue time
    // is not one.
    const { container } = render(
      column("timestamp").renderActive(queuedRun, ctx()),
    );
    expect(container.textContent).toBe("—");
  });

  it("counts a running run's duration from its start", () => {
    const { container } = render(
      column("duration").renderActive(
        startedRun,
        ctx({ now: Date.parse(STARTED_AT) + 65_000 }),
      ),
    );
    expect(container.textContent).toBe("1m 5s");
  });

  it("advances the duration as the shared clock does", () => {
    const started = Date.parse(STARTED_AT);
    const at = (now: number) =>
      render(column("duration").renderActive(startedRun, ctx({ now })))
        .container.textContent;
    expect(at(started + 1_000)).toBe("1s");
    expect(at(started + 59_000)).toBe("59s");
    // Whole seconds only, so the count steps 59s → 1m 0s rather than reading "60s"
    // on the way past the minute.
    expect(at(started + 60_400)).toBe("1m 0s");
  });

  it("never counts the time a run spent queued", () => {
    // The one figure this column must never invent. A queued run has been waiting,
    // possibly for a long time, and none of that is run time.
    const { container } = render(
      column("duration").renderActive(
        queuedRun,
        ctx({ now: Date.parse(STARTED_AT) + 3_600_000 }),
      ),
    );
    expect(container.textContent).toBe("—");
  });

  it("clamps a start the browser's clock puts in the future", () => {
    // The stamp is the backend's clock and the tick is the browser's; a skewed pair
    // must read as a run that has just begun, never as a negative duration.
    const { container } = render(
      column("duration").renderActive(
        startedRun,
        ctx({ now: Date.parse(STARTED_AT) - 5_000 }),
      ),
    );
    expect(container.textContent).toBe("0s");
  });

  it("dashes a start it cannot parse rather than printing NaN", () => {
    const broken = { ...activeRun, startedAt: "not a timestamp" };
    expect(
      render(column("duration").renderActive(broken, ctx())).container
        .textContent,
    ).toBe("—");
    expect(
      render(column("timestamp").renderActive(broken, ctx())).container
        .textContent,
    ).toBe("—");
  });
});

// A run the artifact store is holding back says why, since "pending" alone cannot
// tell that hold from a harness at its parallelism cap.
describe("a held run's status cell", () => {
  const pendingRun: InProgressRun = { ...activeRun, state: "pending" };
  const held: ArtifactStorageStatus = {
    state: "blocked",
    runsOnHold: true,
    runsWaitingToStore: 0,
    warnBytes: 3 * 1024 ** 3,
    stopBytes: 2 * 1024 ** 3,
  };

  beforeEach(() => {
    useArtifactStorage.setState({ byWorker: {} });
  });

  function statusCell(run: InProgressRun): HTMLElement {
    const { container } = render(column("rating").renderActive(run, ctx()));
    return container.querySelector("[data-state]") as HTMLElement;
  }

  it("carries the storage hold as its tooltip", () => {
    useArtifactStorage.getState().setStatus("w1", held);

    const cell = statusCell(pendingRun);
    expect(cell).toHaveTextContent("pending");
    expect(cell).toHaveAttribute(
      "title",
      "New runs are on hold: artifact storage is full",
    );
  });

  it("gives no reason when the queue is not on hold", () => {
    // Pending behind its harness's cap, with the store merely low.
    useArtifactStorage
      .getState()
      .setStatus("w1", { ...held, state: "low", runsOnHold: false });
    expect(statusCell(pendingRun)).not.toHaveAttribute("title");
  });

  it("leaves a run that is already running alone", () => {
    useArtifactStorage.getState().setStatus("w1", held);
    expect(statusCell(activeRun)).not.toHaveAttribute("title");
  });

  it("says a finished run is waiting to store its artifacts, and why", () => {
    const cell = statusCell({
      ...activeRun,
      state: "storing",
      detail: "artifact service returned HTTP 507: no space left on device",
    });
    expect(cell).toHaveTextContent("storing…");
    expect(cell).toHaveAttribute(
      "title",
      "Waiting to store artifacts: artifact service returned HTTP 507: no space left on device",
    );
  });

  it("says a run is waiting to store even when no reason was reported", () => {
    expect(statusCell({ ...activeRun, state: "storing" })).toHaveAttribute(
      "title",
      "Waiting to store artifacts",
    );
  });
});

// A run whose model has finished and whose build is being validated reads apart
// from a running one, in the status cell and in the in-progress marker alike.
describe("a validating run", () => {
  const validatingRun: InProgressRun = { ...activeRun, state: "validating" };
  const selection = { isSelected: () => false, toggle: () => {} };

  beforeEach(() => {
    useArtifactStorage.setState({ byWorker: {} });
  });

  it("reads validating in the status cell, saying the model has finished", () => {
    const { container } = render(
      column("rating").renderActive(validatingRun, ctx()),
    );
    const cell = container.querySelector("[data-state]") as HTMLElement;
    expect(cell).toHaveTextContent("validating…");
    expect(cell).toHaveAttribute("data-state", "validating");
    expect(cell).toHaveAttribute(
      "title",
      "The model has finished; validating the build",
    );
  });

  it("draws its own marker in the caret gutter, named for the phase", () => {
    const { getByRole } = render(
      column("caret").renderActive(validatingRun, ctx()),
    );
    const marker = getByRole("img", { name: "Validating" });
    expect(marker).toHaveAttribute("data-state", "validating");
    expect(marker).toHaveAttribute("title", "Validating");
    // A checklist of three lines, not the running spinner's ring.
    expect(marker.children).toHaveLength(3);
  });

  it("leaves a running run's marker as the running spinner", () => {
    const { getByRole } = render(
      column("caret").renderActive(activeRun, ctx()),
    );
    const marker = getByRole("img", { name: "Running" });
    expect(marker).toHaveAttribute("data-state", "running");
    expect(marker.children).toHaveLength(0);
  });

  it("draws its marker under the selectable log's checkbox too", () => {
    const { container, getByRole } = render(
      column("caret").renderActive(validatingRun, ctx({ selection })),
    );
    // The checkbox names the control; the marker inside it is decorative.
    expect(getByRole("checkbox", { name: "Select run" })).toBeInTheDocument();
    const marker = container.querySelector(
      '[data-state="validating"]',
    ) as HTMLElement;
    expect(marker).toHaveAttribute("aria-hidden", "true");
    expect(marker).toHaveAttribute("title", "Validating");
  });

  it("draws no marker under a finished row's checkbox", () => {
    const { container } = render(
      column("caret").render(
        { summary: { id: "done-1" } } as Parameters<RunColumn["render"]>[0],
        ctx({ selection }),
      ),
    );
    expect(container.querySelector("[data-state]")).toBeNull();
  });
});
