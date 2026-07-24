import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type {
  GgContextSource,
  GgContextSourceUsage,
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import {
  WorkersProvider,
  type WorkersContextValue,
} from "../../../../client/context";
import type { WorkerClient, RunSubscription } from "../../../../client/clients";
import { GgRunMonitorPage } from "./GgRunMonitorPage";

// gg is headless, so this live monitor is the only window into a run. The page's
// app chrome (PageLayout/PromptHeader) and the kill affordance pull contexts that
// are irrelevant to what this test asserts — that the folded telemetry stream
// renders across the four Phase-1 panels — so stub them, mirroring the config
// page's test.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));
vi.mock("../../../components/KillRunControl", () => ({
  KillRunControl: () => null,
}));

// The fixed nine-source order the context breakdown always reports (zeros
// included), so a partial map fills out to a stable, ordered band set.
const SOURCE_ORDER: GgContextSource[] = [
  "system",
  "user_prompt",
  "assistant",
  "tool_output",
  "file_view",
  "skill",
  "memory",
  "task_list",
  "history",
];
function bySource(
  partial: Partial<Record<GgContextSource, number>>,
): GgContextSourceUsage[] {
  return SOURCE_ORDER.map((source) => ({
    source,
    tokens: partial[source] ?? 0,
  }));
}

const TS = "2026-07-23T00:00:00Z";
// Wrap a gg telemetry payload (the `GgTelemetryKind` variant, sans the base
// timestamp/sessionId this helper supplies) in the `HarnessEvent` envelope the
// live stream delivers.
function gg(kind: GgTelemetryKind): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: { timestamp: TS, sessionId: "s1", ...kind } as GgTelemetryEvent,
  };
}

// A small but representative Phase-1 stream: a session, one agent message, two
// context-breakdown turns (so the stacked graph draws), a task list with a ready
// and a blocked task, two skills (one read), and one curated memory.
const EVENTS: HarnessEvent[] = [
  gg({ type: "session_started" }),
  gg({ type: "assistant_message", text: "Planning the build." }),
  gg({
    type: "context_breakdown",
    bySource: bySource({ system: 1000, user_prompt: 500, history: 200 }),
    totalTokens: 1700,
    windowLimit: 200000,
    fullness: 0.0085,
  }),
  gg({
    type: "context_breakdown",
    bySource: bySource({
      system: 1000,
      user_prompt: 500,
      assistant: 800,
      tool_output: 1200,
      history: 900,
    }),
    totalTokens: 4400,
    windowLimit: 200000,
    fullness: 0.022,
  }),
  gg({
    type: "tasks_state",
    tasks: [
      {
        id: "t1",
        title: "Scaffold the project",
        status: "done",
        blockedBy: [],
      },
      {
        id: "t2",
        title: "Wire the renderer",
        status: "in_progress",
        blockedBy: ["t1"],
      },
      {
        id: "t3",
        title: "Add the win condition",
        status: "pending",
        blockedBy: ["t2"],
      },
    ],
  }),
  gg({
    type: "skills_state",
    skills: [
      { name: "gg-render", description: "How to draw.", read: true },
      { name: "gg-audio", description: "How to make sound.", read: false },
    ],
  }),
  gg({
    type: "memory_state",
    memories: [
      { name: "controls", description: "Input scheme decided.", len: 120 },
    ],
    count: 1,
    totalLen: 120,
    caps: { maxCount: 16, maxLenPerMemory: 2000, maxTotalLen: 16000 },
  }),
  // Phase 3: the epic/issue board — one epic with a done → ready → blocked chain,
  // plus an ungrouped issue (no epicId), so grouping and derived readiness show.
  gg({
    type: "board_state",
    epics: [
      {
        id: "e1",
        title: "Rendering",
        description: "The renderer and scene.",
      },
    ],
    issues: [
      {
        id: "i1",
        title: "Set up the canvas",
        inScope: "Create and size the canvas element.",
        outOfScope: "Any drawing.",
        completionCriteria: "A canvas mounts at the right size.",
        status: "done",
        blockedBy: [],
        epicId: "e1",
      },
      {
        id: "i2",
        title: "Draw the board",
        inScope: "Render the grid to the canvas.",
        outOfScope: "Win detection.",
        completionCriteria: "The grid draws each frame.",
        status: "in_progress",
        blockedBy: ["i1"],
        epicId: "e1",
      },
      {
        id: "i3",
        title: "Add win overlay",
        inScope: "Show a win banner.",
        outOfScope: "Scoring.",
        completionCriteria: "A banner appears on a win.",
        status: "open",
        blockedBy: ["i2"],
        epicId: "e1",
      },
      {
        id: "i4",
        title: "Wire audio",
        inScope: "Play a move sound.",
        outOfScope: "Music.",
        completionCriteria: "A sound plays on a move.",
        status: "open",
        blockedBy: [],
      },
    ],
  }),
  // Phase 3: a planning pass — enter read-only plan mode, submit a plan, then
  // implement from a fresh context seeded with it (the plan→implement transition).
  gg({ type: "planning", phase: "entered" }),
  gg({
    type: "planning",
    phase: "submitted",
    plan: "1. Scaffold the project\n2. Wire the renderer\n3. Add the win condition",
  }),
  gg({
    type: "planning",
    phase: "implementing",
    plan: "1. Scaffold the project\n2. Wire the renderer\n3. Add the win condition",
  }),
  // Phase 2: a compaction boundary (summarize-and-drop, honoring the retention
  // contract), the reclaimed post-compaction breakdown it drops to, and the agent
  // evicting a file view itself.
  gg({
    type: "compaction",
    triggerFullness: 0.85,
    beforeTokens: 4400,
    afterTokens: 1800,
    summaryTokens: 300,
    retained: { skills: 1, tasks: 3, memories: 1, issues: 2 },
  }),
  gg({
    type: "context_breakdown",
    bySource: bySource({ system: 1000, user_prompt: 500, history: 300 }),
    totalTokens: 1800,
    windowLimit: 200000,
    fullness: 0.009,
  }),
  gg({
    type: "context_managed",
    action: "evict_file_views",
    reclaimedTokens: 1200,
    items: 1,
    detail: "Evicted 1 file view (level.json), reclaiming ~1200 tokens.",
  }),
];

// A worker whose live subscription replays a fixed event set synchronously, then
// stays open (never calls onDone), so the page holds the "running" phase and its
// live panels render from the folded stream.
function workersValue(events: HarnessEvent[]): WorkersContextValue {
  const client = {
    subscribeToRun: (_runId: string, handlers: RunSubscription) => {
      for (const event of events) handlers.onEvent(event);
      return () => {};
    },
  } as unknown as WorkerClient;
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

function renderMonitor(events: HarnessEvent[] = EVENTS) {
  return render(
    <MemoryRouter initialEntries={["/runs/gg/job-1/live"]}>
      <WorkersProvider value={workersValue(events)}>
        <Routes>
          <Route path="/runs/gg/:jobId/live" element={<GgRunMonitorPage />} />
        </Routes>
      </WorkersProvider>
    </MemoryRouter>,
  );
}

describe("GgRunMonitorPage", () => {
  it("renders the gg-native activity feed from the folded stream", () => {
    renderMonitor();
    // The session started, so the cockpit reads Running (not Queued) and the
    // agent's message shows in the Activity feed.
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Planning the build.")).toBeInTheDocument();
  });

  it("shows the context-fill graph with its fullness signal", () => {
    renderMonitor();
    fireEvent.click(screen.getByRole("radio", { name: "Context" }));
    // The fullness meter (the signal compaction acts on) and the per-source
    // legend both render from the latest breakdown snapshot.
    expect(
      screen.getByRole("meter", { name: "Context window fullness" }),
    ).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("renders the task DAG with derived ready/blocked/done grouping", () => {
    renderMonitor();
    fireEvent.click(screen.getByRole("radio", { name: "Tasks" }));
    // Titles unique to a task node (t2's title also appears as t3's outstanding
    // blocker chip, so assert on the ones that are not echoed as edges).
    expect(screen.getByText("Scaffold the project")).toBeInTheDocument();
    expect(screen.getByText("Add the win condition")).toBeInTheDocument();
    // t3 is blocked by the still-open t2, so the Blocked bucket appears.
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("renders the epic/issue board with grouping and derived readiness", () => {
    renderMonitor();
    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    // Issues group under their epic, and an issue with no epicId falls into the
    // Ungrouped bucket.
    expect(screen.getByText("Rendering")).toBeInTheDocument();
    expect(screen.getByText("Add win overlay")).toBeInTheDocument();
    expect(screen.getByText("Ungrouped")).toBeInTheDocument();
    expect(screen.getByText("Wire audio")).toBeInTheDocument();
    // i2's blocker (i1) is done, so i2 is READY; i3's blocker (i2) is not done, so
    // i3 is BLOCKED — both derived states render as chips.
    expect(screen.getAllByText("ready").length).toBeGreaterThan(0);
    expect(screen.getAllByText("blocked").length).toBeGreaterThan(0);
    // The structured brief is available (collapsed) on each issue.
    expect(screen.getAllByText("Brief").length).toBe(4);
  });

  it("renders the plan view and marks the plan→implement transition in the feed", () => {
    renderMonitor();
    // The planning transitions read as distinct rows in the Activity feed.
    expect(
      screen.getByText(
        "Entered plan mode — read-only exploration, no mutations.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Implementing from the plan — fresh context, original prompt plus plan.",
      ),
    ).toBeInTheDocument();
    // The Plan tab shows the current phase banner (Implementing) and the submitted
    // plan text.
    fireEvent.click(screen.getByRole("radio", { name: "Plan" }));
    expect(screen.getByText("Implementing")).toBeInTheDocument();
    expect(screen.getByText(/Scaffold the project/)).toBeInTheDocument();
  });

  it("renders the skills and memories knowledge views", () => {
    renderMonitor();
    fireEvent.click(screen.getByRole("radio", { name: "Knowledge" }));
    expect(screen.getByText("gg-render")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 read")).toBeInTheDocument();
    expect(screen.getByText("controls")).toBeInTheDocument();
  });

  it("renders compaction boundaries and evict actions in the activity feed", () => {
    renderMonitor();
    // The compaction boundary reads as a distinct row: before→after tokens and the
    // retained-state proof (the pinned state carried across verbatim).
    expect(
      screen.getByText("Context compacted: 4.4k → 1.8k tokens."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("retained 1 skill / 3 tasks / 1 memory"),
    ).toBeInTheDocument();
    // The agent's own evict reclaim shows too, with what it freed.
    expect(
      screen.getByText(
        "Evicted 1 file view (level.json), reclaiming ~1200 tokens.",
      ),
    ).toBeInTheDocument();
  });

  it("marks compaction boundaries with their retained state on the context tab", () => {
    renderMonitor();
    fireEvent.click(screen.getByRole("radio", { name: "Context" }));
    // The boundary caption under the graph names the turn, the drop, and the pinned
    // state the retention contract carried across.
    expect(
      screen.getByText("Compacted at turn 2: 4.4k → 1.8k tokens"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("retained 1 skill / 3 tasks / 1 memory"),
    ).toBeInTheDocument();
  });

  it("shows retained state carrying over on the knowledge tab", () => {
    renderMonitor();
    fireEvent.click(screen.getByRole("radio", { name: "Knowledge" }));
    // The Knowledge tab keeps showing the skills/memories after a compaction, with a
    // note that they survived the boundary verbatim.
    expect(screen.getByText("gg-render")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Retained verbatim across 1 compaction — the skills and memories carried over.",
      ),
    ).toBeInTheDocument();
  });

  it("shows empty states when no gg telemetry arrives", () => {
    renderMonitor([]);
    // No session_started yet ⇒ Queued; the feed shows its waiting state.
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Waiting for telemetry…")).toBeInTheDocument();
  });
});
