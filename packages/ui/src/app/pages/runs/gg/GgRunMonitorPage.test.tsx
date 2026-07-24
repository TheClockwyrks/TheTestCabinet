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

// Wrap a gg payload attributed to a specific agent — the Phase-4 agent identity
// rides on the event envelope (`agentId`/`parentAgentId`), not the payload — so a
// stream can spawn subagents, transition them, and roll up their per-slot usage.
function ggFrom(
  agentId: string,
  parentAgentId: string | undefined,
  kind: GgTelemetryKind,
): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId,
      parentAgentId,
      ...kind,
    } as GgTelemetryEvent,
  };
}

// Wrap a gg payload scoped to a board issue — the reviewed issue of a `code_review`
// rides on the event envelope's `issueId`, not the payload — so a stream can gate an
// issue's acceptance through its Code Review lifecycle.
function ggIssue(issueId: string, kind: GgTelemetryKind): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId: "root",
      issueId,
      ...kind,
    } as GgTelemetryEvent,
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

  it("renders the multi-agent tree with running/waiting/done status, worktree, per-slot cost, and workflow", () => {
    // A small Phase-4 stream that exercises the whole Agents view: the root spawns
    // two subagents — a reviewer in an isolated worktree that runs, returns, and
    // merges back (done), and a builder on the main tree that is still running —
    // while the root itself is blocked waiting on them (rendered as "waiting"). A
    // per-slot usage rollup lands and a one-stage workflow ran. Result: a genuine
    // three-node tree covering running + waiting + done at once.
    const events: HarnessEvent[] = [
      gg({ type: "session_started" }),
      ggFrom("agent-0", "root", {
        type: "agent_spawned",
        slot: "reviewer",
        modelId: "claude-haiku-4-8",
        depth: 1,
        brief: "Review the renderer for correctness.",
        worktree: "gg/agent-0",
      }),
      ggFrom("agent-0", "root", { type: "agent_status", status: "running" }),
      ggFrom("agent-0", "root", {
        type: "agent_returned",
        summary: "Renderer looks correct; one nit filed.",
      }),
      ggFrom("agent-0", "root", {
        type: "worktree_merged",
        branch: "gg/agent-0",
        merged: true,
        conflicts: false,
      }),
      // A second subagent on the main tree (no worktree) that is still running,
      // and the root blocked waiting on its subagents.
      ggFrom("agent-1", "root", {
        type: "agent_spawned",
        slot: "builder",
        modelId: "claude-sonnet-4-8",
        depth: 1,
        brief: "Build the win overlay.",
      }),
      ggFrom("agent-1", "root", { type: "agent_status", status: "running" }),
      ggFrom("root", undefined, { type: "agent_status", status: "blocked" }),
      gg({
        type: "slot_usage",
        slot: "reviewer",
        modelId: "claude-haiku-4-8",
        tokens: {
          uncachedInput: 1200,
          cachedInput: 0,
          output: 300,
          reasoning: null,
        },
        cost: { comparable: 0.0021, actual: 0.0021 },
      }),
      gg({
        type: "workflow_stage",
        workflowId: "wf-1",
        stage: "review",
        stageIndex: 0,
        itemCount: 3,
        phase: "finished",
      }),
    ];
    renderMonitor(events);
    fireEvent.click(screen.getByRole("radio", { name: "Agents" }));
    // A three-node tree: the two subagents both appear as nodes.
    expect(screen.getByText("agent-0")).toBeInTheDocument();
    expect(screen.getByText("agent-1")).toBeInTheDocument();
    // All three lifecycle states render at once — the running builder, the root
    // waiting (blocked) on its subagents, and the returned reviewer (done).
    expect(screen.getAllByText("running").length).toBeGreaterThan(0);
    expect(screen.getByText("waiting")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
    // The reviewer node shows its slot/model and its worktree branch with the
    // merged outcome. The slot ("reviewer") and its model appear both on the tree
    // node and in the per-slot panel, so assert ≥1 each.
    expect(screen.getAllByText("reviewer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("claude-haiku-4-8").length).toBeGreaterThan(0);
    expect(screen.getByText(/gg\/agent-0/)).toBeInTheDocument();
    expect(screen.getByText("merged")).toBeInTheDocument();
    expect(
      screen.getByText("Renderer looks correct; one nit filed."),
    ).toBeInTheDocument();
    // The per-slot usage breakdown lists the (slot, model) with its cost — and the
    // header total is the sum of the rollups, so the same figure appears twice
    // (the reconciliation: header total ↔ per-slot breakdown).
    expect(screen.getAllByText("$0.0021").length).toBeGreaterThanOrEqual(2);
    // The workflow strip labels the declared stage and its fan-out count.
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.getByText("×3")).toBeInTheDocument();
  });

  it("shows the FSM current-state strip and marks transitions in the feed", () => {
    // A built-in TDD machine drives the run through write_tests → implement; the
    // strip shows the ordered path with the current state highlighted, and each
    // transition is marked in the Activity feed.
    const events: HarnessEvent[] = [
      gg({ type: "session_started" }),
      gg({
        type: "fsm_state",
        machine: "tdd",
        state: "write_tests",
        stateIndex: 0,
      }),
      gg({
        type: "fsm_state",
        machine: "tdd",
        state: "implement",
        stateIndex: 1,
      }),
    ];
    renderMonitor(events);
    // The strip names the machine and its ordered states (past + current chips).
    expect(screen.getByText("tdd")).toBeInTheDocument();
    expect(screen.getByText("write_tests")).toBeInTheDocument();
    expect(screen.getByText("implement")).toBeInTheDocument();
    // Each FSM transition is marked as a distinct row in the Activity feed.
    expect(screen.getByText("tdd → write_tests")).toBeInTheDocument();
    expect(screen.getByText("tdd → implement")).toBeInTheDocument();
  });

  it("surfaces Code Review status and actionable items on the board", () => {
    // Two issues: one whose Code Review requested changes (gating its acceptance,
    // with actionable items a fix agent must address) and one whose review approved
    // (now accepted / done). The reviewed issue rides on the event envelope.
    const issue = (
      id: string,
      title: string,
      status: "open" | "in_progress" | "done",
    ) => ({
      id,
      title,
      inScope: "",
      outOfScope: "",
      completionCriteria: "",
      status,
      blockedBy: [] as string[],
    });
    const events: HarnessEvent[] = [
      gg({ type: "session_started" }),
      gg({
        type: "board_state",
        epics: [],
        issues: [
          issue("i1", "Set up the canvas", "in_progress"),
          issue("i2", "Draw the board", "done"),
        ],
      }),
      ggIssue("i1", { type: "code_review", phase: "requested" }),
      ggIssue("i1", {
        type: "code_review",
        phase: "changes_requested",
        items: ["Handle the empty-input case", "Add a unit test"],
      }),
      ggIssue("i2", { type: "code_review", phase: "approved" }),
    ];
    renderMonitor(events);
    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    // i1's review requested changes — the badge and its actionable items show, so
    // the acceptance gate and the remaining work are legible on the board.
    expect(screen.getByText("changes requested")).toBeInTheDocument();
    expect(screen.getByText("Handle the empty-input case")).toBeInTheDocument();
    expect(screen.getByText("Add a unit test")).toBeInTheDocument();
    // i2's review approved — the approved badge shows (its acceptance is unblocked).
    expect(screen.getByText("approved")).toBeInTheDocument();
  });

  it("marks the chosen winner and dims the losers of a best-of-K speculation on the agent tree", () => {
    // A best-of-3 speculation: the root fans out three attempt subagents (each in
    // its own worktree) plus a judge, the judge picks agent-1, and agent-1 merges
    // while the other two are discarded. The lifecycle rides `speculation` events
    // (fanned_out → judged → merged); the attempt/judge agents are tree nodes and the
    // winner is named by agent id on the envelope-free payload.
    const attempt = (id: string) =>
      ggFrom(id, "root", {
        type: "agent_spawned",
        slot: "primary",
        modelId: "claude-sonnet-4-8",
        depth: 1,
        brief: "Attempt the win overlay.",
        worktree: `gg/${id}`,
      });
    const events: HarnessEvent[] = [
      gg({ type: "session_started" }),
      attempt("agent-0"),
      attempt("agent-1"),
      attempt("agent-2"),
      // The judge runs on the main tree (no worktree), so it is not an attempt.
      ggFrom("agent-3", "root", {
        type: "agent_spawned",
        slot: "reviewer",
        modelId: "claude-haiku-4-8",
        depth: 1,
        brief: "Judge the three attempts.",
      }),
      gg({ type: "speculation", attempts: 3, phase: "fanned_out" }),
      gg({
        type: "speculation",
        attempts: 3,
        phase: "judged",
        winner: "agent-1",
        rationale: "Cleanest overlay with a passing test.",
      }),
      gg({
        type: "speculation",
        attempts: 3,
        phase: "merged",
        winner: "agent-1",
      }),
      // The winner merges; the two losing attempts are discarded.
      ggFrom("agent-1", "root", {
        type: "worktree_merged",
        branch: "gg/agent-1",
        merged: true,
        conflicts: false,
      }),
      ggFrom("agent-0", "root", {
        type: "worktree_merged",
        branch: "gg/agent-0",
        merged: false,
        conflicts: false,
      }),
      ggFrom("agent-2", "root", {
        type: "worktree_merged",
        branch: "gg/agent-2",
        merged: false,
        conflicts: false,
      }),
    ];
    renderMonitor(events);
    fireEvent.click(screen.getByRole("radio", { name: "Agents" }));
    // The speculation summary: best-of-3, merged, with the winning attempt named.
    // ("merged" appears both as the speculation phase and the winner's worktree
    // outcome, so assert at least one is present.)
    expect(screen.getByText("best-of-3")).toBeInTheDocument();
    expect(screen.getAllByText("merged").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("Cleanest overlay with a passing test."),
    ).toBeInTheDocument();
    // The winner is marked distinctly on its tree node.
    const winnerBadge = screen.getByText("★ winner");
    expect(winnerBadge).toBeInTheDocument();
    // The winner badge sits on agent-1's node; the two other attempts are marked as
    // losers (dimmed) and the judge carries no speculation role.
    const rows = document.querySelectorAll("[data-spec-role]");
    const winnerRows = document.querySelectorAll('[data-spec-role="winner"]');
    const loserRows = document.querySelectorAll('[data-spec-role="loser"]');
    expect(winnerRows.length).toBe(1);
    expect(loserRows.length).toBe(2);
    // Judge (agent-3, no worktree) is not classified, so exactly 3 nodes are marked.
    expect(rows.length).toBe(3);
  });

  it("shows empty states when no gg telemetry arrives", () => {
    renderMonitor([]);
    // No session_started yet ⇒ Queued; the feed shows its waiting state.
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Waiting for telemetry…")).toBeInTheDocument();
  });
});
