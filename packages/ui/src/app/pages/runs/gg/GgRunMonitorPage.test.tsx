import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { useAppSettings } from "../../../store/appSettings";
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
// issue's acceptance through its review lifecycle.
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

// gg announces its capability set on `session_started`, and the monitor offers only
// the panels that set justifies — so every stream here says what its run could do.
// `ALL_CAPABILITIES` is the "everything on" configuration most of these streams
// exercise; the gating test below narrows it deliberately.
const ALL_CAPABILITIES = [
  "shell",
  "filesystem",
  "context-window-override",
  "compaction",
  "skills",
  "memories",
  "tasks",
  "project-management",
  "planning",
  "subagents",
  "multi-model",
  "workflows",
  "fsm",
  "speculative-execution",
];
function sessionStarted(
  capabilities: ReadonlyArray<string> = ALL_CAPABILITIES,
): HarnessEvent {
  return sessionStartedWith([{ name: "Root", capabilities }]);
}

// The same announcement for a **multi-profile** run: gg's capabilities are per-agent,
// so a run routinely gives its agents different ones (a Root that files work but keeps
// no task list; an implementer that keeps one but files nothing). Every per-agent
// surface has to read the profile the agent it is showing runs under, so these streams
// are the ones that catch a surface reading the Root's configuration for everybody.
function sessionStartedWith(
  profiles: ReadonlyArray<{
    name: string;
    capabilities: ReadonlyArray<string>;
  }>,
): HarnessEvent {
  return gg({
    type: "session_started",
    capabilitySet: {
      agents: profiles.map(({ name, capabilities }) => ({
        name,
        capabilities: capabilities.map((id) => ({
          id,
          enabled: true,
          params: {},
        })),
        modelId: "mock/scripted-builder",
      })),
    },
  });
}

// A small but representative Phase-1 stream: a session, one agent message, two
// context-breakdown turns (so the stacked graph draws), a task list with a ready
// and a blocked task, two skills (one read), and one curated memory.
const EVENTS: HarnessEvent[] = [
  sessionStarted(),
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
    strategy: "scratchpad",
    memories: [
      {
        name: "controls",
        description: "Input scheme decided.",
        len: 120,
        lines: 4,
      },
    ],
    count: 1,
    totalLen: 120,
    totalLines: 4,
    peak: { count: 2, totalLen: 300, totalLines: 9 },
    caps: {
      maxCount: 16,
      maxLenPerMemory: 2000,
      maxTotalLen: 16000,
      maxLenIndex: null,
      maxLenDescription: null,
      maxResults: null,
    },
  }),
  // The revision stream behind that snapshot: a memory that is still held, and one
  // the model wrote and then deleted — which the snapshot above cannot show, and
  // which the Memories panel reports from here.
  gg({
    type: "memory_revision",
    name: "controls",
    revision: 1,
    change: "written",
    description: "Input scheme drafted.",
    body: "WASD to move.",
    len: 13,
    lines: 1,
  }),
  gg({
    type: "memory_revision",
    name: "controls",
    revision: 2,
    change: "updated",
    description: "Input scheme decided.",
    body: "WASD to move.\nSpace to jump.\nShift to sprint.\nE to interact.",
    len: 120,
    lines: 4,
  }),
  gg({
    type: "memory_revision",
    name: "palette",
    revision: 1,
    change: "written",
    description: "Colours picked.",
    body: "Teal and sand.",
    len: 14,
    lines: 1,
  }),
  gg({
    type: "memory_revision",
    name: "palette",
    revision: 2,
    change: "deleted",
    description: "",
    body: "",
    len: 0,
    lines: 0,
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
        agent: "implementer",
        retries: 0,
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
        agent: "implementer",
        reviewers: ["critic"],
        retries: 0,
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
        agent: "implementer",
        retries: 0,
      },
      {
        id: "i4",
        title: "Wire audio",
        inScope: "Play a move sound.",
        outOfScope: "Music.",
        completionCriteria: "A sound plays on a move.",
        status: "open",
        blockedBy: [],
        agent: "implementer",
        retries: 0,
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
    strategy: "model",
    triggerFullness: 0.85,
    beforeTokens: 4400,
    afterTokens: 1800,
    summaryTokens: 300,
    retained: { skills: 1, tasks: 3, memories: 1, issues: 2 },
    beforeBySource: bySource({
      system: 1000,
      assistant: 2400,
      tool_output: 1000,
    }),
    afterBySource: bySource({ system: 1000, user_prompt: 500, history: 300 }),
    summary:
      "Summary of earlier work: scaffolded the project and wired the renderer.",
    summaryFallback: false,
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

// The view is led by a tab selector: the whole-run Dashboard (the default), the
// per-agent Agents explorer, and — when the project-management capability is on — the
// run-global Project board. Everything a run lets you read about one agent is a
// "file" inside that agent's folder in the Agents explorer, so reading an agent's
// activity, context, tasks, … starts by opening the Agents tab; the shared board is
// read on the Project tab.
function openTab(name: "Dashboard" | "Agents" | "Project") {
  fireEvent.click(screen.getByRole("radio", { name }));
}

// Open one file in the Agents explorer. Folders are expanded by default, so every
// file is reachable; each file row is labeled with its agent so it is unambiguous
// (e.g. "root activity", "agent-0 overview").
function openFile(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("GgRunMonitorPage", () => {
  // The feed style is a persisted, app-wide preference; hold it at the default so
  // one test's choice can't leak into the next.
  beforeEach(() => {
    useAppSettings.getState().setEventFeedStyle("gutter");
  });

  it("leads with the Dashboard panel, carrying the run-level read-out", () => {
    renderMonitor();
    // Dashboard is the first tab and the one selected by default, so the run's
    // status, its token/cost tally, how many agents ran, and the configuration all
    // read without touching the selector.
    expect(screen.getByRole("radio", { name: "Dashboard" })).toBeChecked();
    expect(screen.getByText("Running")).toBeInTheDocument();
    // Tokens and cost read as two separate widgets now.
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("mock/scripted-builder")).toBeInTheDocument();
    // A single-agent run's overview lists the one (root) agent.
    expect(screen.getByText("Agents · 1")).toBeInTheDocument();
    expect(screen.getAllByText("root").length).toBeGreaterThan(0);
  });

  it("charts the caching and reasoning token splits as rings with the raw counts", () => {
    // A single usage delta: 800 uncached + 1200 cached input (60% cached), and
    // 300 output + 100 reasoning (25% reasoning). The Dashboard's two rings read
    // those shares, and their legends carry the raw token counts.
    renderMonitor([
      sessionStarted(),
      gg({
        type: "usage",
        tokens: {
          uncachedInput: 800,
          cachedInput: 1200,
          output: 300,
          reasoning: 100,
        },
        cost: { comparable: 0.005, actual: 0.005 },
      }),
    ]);
    expect(screen.getByText("Input caching")).toBeInTheDocument();
    expect(screen.getByText("Output tokens")).toBeInTheDocument();
    // The input ring reads 60% cached in its center; its legend gives both raw
    // counts and shares.
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("1,200 · 60%")).toBeInTheDocument();
    expect(screen.getByText("800 · 40%")).toBeInTheDocument();
    // The output ring centers on the output share (75%) — "reasoning" is too long
    // to read inside the ring — while its legend still carries both classes' raw
    // counts and shares (25% of output was reasoning).
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("100 · 25%")).toBeInTheDocument();
    expect(screen.getByText("300 · 75%")).toBeInTheDocument();
  });

  it("lays the run out as a filesystem of agents-as-folders and views-as-files", () => {
    renderMonitor();
    openTab("Agents");
    // The main agent is the top-level folder, and each thing this run lets you
    // monitor about it is a file in its folder. ("root" also names the agent on its
    // open Overview, so there is more than one.)
    expect(screen.getAllByText("root").length).toBeGreaterThan(0);
    expect(screen.getByText("main agent")).toBeInTheDocument();
    for (const file of [
      "root overview",
      "root activity",
      "root context",
      "root plan",
      "root tasks",
      "root knowledge",
    ]) {
      expect(screen.getByRole("button", { name: file })).toBeInTheDocument();
    }
    // The board is no longer a per-agent file — it reads on the run-global Project
    // tab instead.
    expect(screen.queryByRole("button", { name: "root board" })).toBeNull();
  });

  it("renders the gg-native activity feed on an agent's activity file", () => {
    renderMonitor();
    openTab("Agents");
    openFile("root activity");
    expect(screen.getByText("Planning the build.")).toBeInTheDocument();
    // The compaction boundary and the agent's own evict reclaim read as distinct
    // rows, with the retained-state proof.
    expect(
      screen.getByText("Context compacted: 4.4k → 1.8k tokens."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("retained 1 skill / 3 tasks / 1 memory"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Evicted 1 file view (level.json), reclaiming ~1200 tokens.",
      ),
    ).toBeInTheDocument();
  });

  it("renders an agent's activity through the shared feed, in the layout the user picked", () => {
    useAppSettings.getState().setEventFeedStyle("stacked");
    renderMonitor();
    openTab("Agents");
    openFile("root activity");
    const feed = document.querySelector("[data-feed-style]");
    expect(feed).toHaveAttribute("data-feed-style", "stacked");
    expect(
      document.querySelector('[data-event-type="agent"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-event-type="compact"]'),
    ).toBeInTheDocument();
  });

  it("shows the context-fill graph on an agent's context file", () => {
    renderMonitor();
    openTab("Agents");
    openFile("root context");
    // The composition story lives on the context file — the source legend and the
    // compaction boundary with its retained state.
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(
      screen.getByText("Compacted at turn 2: 4.4k → 1.8k tokens"),
    ).toBeInTheDocument();
    // The fullness meter moved to the agent's Overview, beside its other
    // whole-agent figures, so it no longer heads the context panel.
    expect(
      screen.queryByRole("meter", { name: "Context window fullness" }),
    ).not.toBeInTheDocument();
    openFile("root overview");
    expect(
      screen.getByRole("meter", { name: "Context window fullness" }),
    ).toBeInTheDocument();
  });

  it("renders the task DAG on an agent's tasks file", () => {
    renderMonitor();
    openTab("Agents");
    openFile("root tasks");
    expect(screen.getByText("Scaffold the project")).toBeInTheDocument();
    expect(screen.getByText("Add the win condition")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("renders the run-global epic/issue board on the Project tab", () => {
    renderMonitor();
    openTab("Project");
    // The board is a filesystem of epics-as-folders holding issues-as-folders — the
    // epic titles, the ungrouped bucket, and every issue named `id: title` read in the
    // sidebar. ("Rendering" reads twice: the epic folder and the epic Overview the
    // default landing selects.)
    expect(screen.getAllByText("Rendering").length).toBeGreaterThan(0);
    expect(screen.getByText("Ungrouped")).toBeInTheDocument();
    expect(screen.getByText("i3: Add win overlay")).toBeInTheDocument();
    expect(screen.getByText("i4: Wire audio")).toBeInTheDocument();
    // Selecting a blocked issue's Overview shows its detail: its ONE state badge (which
    // folds its status together with its unmet blocker), its retries, and its brief.
    openFile("i3 overview");
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Retries")).toBeInTheDocument();
    expect(screen.getByText("Show a win banner.")).toBeInTheDocument();
    // And only that badge: the separate status/readiness chips the header used to carry
    // said the same thing twice.
    expect(screen.queryByText("open")).not.toBeInTheDocument();
    expect(screen.queryByText("blocked")).not.toBeInTheDocument();
  });

  it("indents the files under an epic folder, like the Agents tree", () => {
    // The Project sidebar is the same filesystem tree the Agents explorer is, and
    // its nesting is carried by a per-depth inline indent rather than by CSS (the
    // Agents tree nests arbitrarily deep). Without it every row lines up flush with
    // its folder and the tree reads as a flat list.
    renderMonitor();
    openTab("Project");
    const folder = screen
      .getAllByRole("button")
      .find((el) => el.getAttribute("aria-expanded") === "true");
    expect(folder).toBeDefined();
    const issue = screen.getByRole("button", { name: "issue i3" });
    const overview = screen.getByRole("button", { name: "i3 overview" });
    const padding = (el: HTMLElement) => parseFloat(el.style.paddingLeft);
    expect(padding(folder!)).toBeGreaterThan(0);
    expect(padding(issue)).toBeGreaterThan(padding(folder!));
    // An issue is a folder of its own, so its Overview nests one level deeper again.
    expect(padding(overview)).toBeGreaterThan(padding(issue));
  });

  it("renders the plan on an agent's plan file", () => {
    renderMonitor();
    openTab("Agents");
    openFile("root plan");
    expect(screen.getByText("Implementing")).toBeInTheDocument();
    expect(screen.getByText(/Scaffold the project/)).toBeInTheDocument();
  });

  it("renders skills and memories on an agent's knowledge file", () => {
    renderMonitor();
    openTab("Agents");
    openFile("root knowledge");
    expect(screen.getByText("gg-render")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 read")).toBeInTheDocument();
    // A live memory is named twice — once as a treemap tile, once as a record row.
    expect(screen.getAllByText("controls").length).toBeGreaterThan(0);
    // The record covers memories the snapshot cannot: `palette` was written and then
    // deleted, so it is absent from `memory_state` and present here, marked deleted.
    expect(screen.getAllByText("palette").length).toBeGreaterThan(0);
    expect(screen.getAllByText("deleted").length).toBeGreaterThan(0);
    // Each memory's revisions are collapsed behind a count.
    expect(screen.getAllByText("2 revisions")).toHaveLength(2);
    // Current and peak usage are both reported, so a curated-down store still says
    // what it once held.
    expect(screen.getByText("Characters")).toBeInTheDocument();
    expect(screen.getByText("peak 300")).toBeInTheDocument();
    expect(screen.getByText("peak 9")).toBeInTheDocument();
    // The retention note says the knowledge survived the compaction verbatim.
    expect(
      screen.getByText(
        "Retained verbatim across 1 compaction — the skills and memories carried over.",
      ),
    ).toBeInTheDocument();
  });

  it("offers a file for every enabled capability, even before it has data", () => {
    // A narrow run: tasks + memories on, and NO tasks/memory events have arrived
    // yet. The files a capability justifies are offered up front — a file is gated
    // by the run's configuration, not by whether data has streamed — so `tasks` and
    // `knowledge` are present (showing their own empty state), Context is
    // unconditional, and the capability the run lacks (planning) offers no file at
    // all.
    renderMonitor([
      sessionStarted(["shell", "tasks", "memories"]),
      gg({ type: "assistant_message", text: "Working." }),
    ]);
    openTab("Agents");
    for (const file of [
      "root overview",
      "root activity",
      "root context",
      "root tasks",
      "root knowledge",
    ]) {
      expect(screen.getByRole("button", { name: file })).toBeInTheDocument();
    }
    for (const file of ["root plan", "root board"]) {
      expect(screen.queryByRole("button", { name: file })).toBeNull();
    }
    // With project-management off there is also no Project tab.
    expect(screen.queryByRole("radio", { name: "Project" })).toBeNull();
    // An enabled-but-empty file is present and shows its own "nothing yet" state,
    // rather than being hidden until data arrives.
    openFile("root tasks");
    expect(screen.getByText(/No tasks yet/)).toBeInTheDocument();
  });

  it("offers each agent the files its own profile justifies, not the Root's", () => {
    // The ordinary shape of a board run: the Root files work and keeps no task list;
    // the `Coder` profile an issue dispatches under keeps one and files nothing.
    // Reading the Root's configuration for every folder hid the task file on exactly
    // the agent that had the capability.
    renderMonitor([
      sessionStartedWith([
        { name: "Root", capabilities: ["shell", "project-management"] },
        { name: "Coder", capabilities: ["shell", "tasks"] },
      ]),
      ggFrom("agent-0", undefined, {
        type: "agent_spawned",
        slot: "Coder",
        modelId: "mock/scripted-builder",
        depth: 0,
        brief: "Implement the widget.",
      }),
      ggFrom("agent-0", undefined, {
        type: "tasks_state",
        tasks: [
          {
            id: "t1",
            title: "Draw the widget",
            status: "in_progress",
            blockedBy: [],
          },
        ],
      }),
    ]);
    openTab("Agents");
    expect(
      screen.getByRole("button", { name: "agent-0 tasks" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "root tasks" })).toBeNull();
    // And the file reads that agent's own list.
    openFile("agent-0 tasks");
    expect(screen.getByText("Draw the widget")).toBeInTheDocument();
  });

  it("offers the Project tab when any profile owns the board, not only the Root", () => {
    // The board is one thing shared by the whole run, so which profile happens to
    // author it does not decide whether the run has one — a set that puts project
    // management on a dedicated planning profile still has a board to read.
    renderMonitor([
      sessionStartedWith([
        { name: "Root", capabilities: ["shell", "subagents"] },
        { name: "Planner", capabilities: ["shell", "project-management"] },
      ]),
      gg({
        type: "board_state",
        epics: [],
        issues: [
          {
            id: "feat-1",
            title: "Add the widget",
            status: "open",
            blockedBy: [],
            inScope: "The widget.",
            outOfScope: "Nothing else.",
            completionCriteria: "It works.",
            agent: "Coder",
            retries: 0,
          },
        ],
      }),
    ]);
    openTab("Project");
    // Named twice: the sidebar row, and the detail the default landing selects.
    expect(screen.getAllByText("Add the widget").length).toBeGreaterThan(0);
  });

  it("nests subagents as folders under their spawner, each read on its own file", () => {
    // The root spawns a reviewer (isolated worktree; runs, returns, merges → done)
    // and a builder (main tree; still running); the root is blocked waiting on them.
    // A per-slot usage rollup lands and a one-stage workflow ran.
    const events: HarnessEvent[] = [
      sessionStarted(),
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
    // The Dashboard's agent overview lists all three agents.
    expect(screen.getByText("Agents · 3")).toBeInTheDocument();
    // The per-slot usage breakdown is a whole-run cost fact, so it reads on the
    // Dashboard: the reviewer slot's model, and its cost both as the Cost widget's
    // total and in the per-slot row — so more than one node carries the figure.
    // ("reviewer" reads twice now — the per-slot row and the agent overview's slot
    // chip.)
    expect(screen.getByText("Per-slot usage")).toBeInTheDocument();
    expect(screen.getAllByText("reviewer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.0021").length).toBeGreaterThan(1);

    openTab("Agents");
    // The delegation tree is the directory tree: root → subagents → the two children.
    expect(screen.getByText("subagents")).toBeInTheDocument();
    expect(screen.getByText("agent-0")).toBeInTheDocument();
    expect(screen.getByText("agent-1")).toBeInTheDocument();

    // The root's Overview (the default) carries the run-level delegation structure —
    // the declared workflow — and the root itself is waiting. (Per-slot usage no
    // longer lives here; it reads on the Dashboard above.)
    expect(screen.getByText("waiting")).toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.getByText("×3")).toBeInTheDocument();

    // The reviewer subagent reads on its own Overview: slot/model, its worktree with
    // the merged outcome, its returned value, and its done status.
    openFile("agent-0 overview");
    expect(screen.getAllByText("reviewer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("claude-haiku-4-8").length).toBeGreaterThan(0);
    expect(screen.getByText(/gg\/agent-0/)).toBeInTheDocument();
    expect(screen.getByText("merged")).toBeInTheDocument();
    expect(
      screen.getByText("Renderer looks correct; one nit filed."),
    ).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();

    // The builder is still running.
    openFile("agent-1 overview");
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("overviews the agents on the Dashboard and jumps into an agent's files", () => {
    // The root reads two files and spawns a reviewer with a brief; the reviewer is
    // given a rendered prompt (system + user) and greps once.
    const events: HarnessEvent[] = [
      sessionStarted(),
      gg({ type: "tool_call", name: "read_file", args: {} }),
      gg({ type: "tool_call", name: "read_file", args: {} }),
      ggFrom("agent-0", "root", {
        type: "agent_spawned",
        slot: "reviewer",
        modelId: "claude-haiku-4-8",
        depth: 1,
        brief: "Review the renderer for correctness.",
      }),
      ggFrom("agent-0", "root", {
        type: "context_message",
        id: "s",
        role: "system",
        content: "you are a reviewer",
        toolCalls: [],
        images: [],
        tokens: 8,
      }),
      ggFrom("agent-0", "root", {
        type: "context_message",
        id: "p",
        role: "user",
        content: "Please review the renderer carefully.",
        toolCalls: [],
        images: [],
        tokens: 12,
      }),
      ggFrom("agent-0", "root", {
        type: "prompt",
        request: [
          { id: "s", source: "system" },
          { id: "p", source: "user_prompt" },
        ],
        totalTokens: 20,
        finishReason: "stop",
        tokens: {
          uncachedInput: 20,
          cachedInput: 0,
          output: 0,
          reasoning: null,
        },
      }),
      ggFrom("agent-0", "root", { type: "tool_call", name: "grep", args: {} }),
    ];
    renderMonitor(events);

    // The Dashboard overviews both agents in place of a bare count, with each agent's
    // tools read as chips — the root's read_file, the reviewer's grep.
    expect(screen.getByText("Agents · 2")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();

    // Clicking the reviewer's row switches to the Agents tab and lands on its Overview,
    // where its tool usage is broken down (grep, called once).
    fireEvent.click(screen.getByRole("button", { name: "Open agent-0" }));
    expect(screen.getByRole("radio", { name: "Agents" })).toBeChecked();
    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.getByText("grep")).toBeInTheDocument();

    // Its Prompt file carries the brief its parent handed it and the rendered prompt.
    openFile("agent-0 prompt");
    expect(screen.getByText("Brief from parent")).toBeInTheDocument();
    expect(
      screen.getByText("Review the renderer for correctness."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please review the renderer carefully."),
    ).toBeInTheDocument();
  });

  it("reconciles the root agent to the session outcome once the run concludes", () => {
    // gg never emits a terminal status for the ROOT agent — its completion is only
    // implied by `session_ended` — so a concluded run must not leave the root's
    // Overview reading as "running" after the fact.
    renderMonitor([
      sessionStarted(),
      gg({ type: "assistant_message", text: "Built the thing." }),
      gg({ type: "session_ended", status: "completed" }),
    ]);
    openTab("Agents");
    // The root's Overview (the default landing) reads the run as done, not running.
    expect(screen.getByText("done")).toBeInTheDocument();
    expect(screen.queryByText("running")).toBeNull();
  });

  it("shows the FSM current-state strip and marks transitions on the activity file", () => {
    const events: HarnessEvent[] = [
      sessionStarted(),
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
    // The strip names the machine and its ordered states on the Dashboard.
    expect(screen.getByText("tdd")).toBeInTheDocument();
    expect(screen.getByText("write_tests")).toBeInTheDocument();
    expect(screen.getByText("implement")).toBeInTheDocument();
    // Each transition is marked as a distinct row on the root's activity file.
    openTab("Agents");
    openFile("root activity");
    expect(screen.getByText("tdd → write_tests")).toBeInTheDocument();
    expect(screen.getByText("tdd → implement")).toBeInTheDocument();
  });

  it("surfaces issue review status and actionable items on the Project tab", () => {
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
      agent: "implementer",
      retries: 0,
    });
    const events: HarnessEvent[] = [
      sessionStarted(),
      gg({
        type: "board_state",
        epics: [],
        issues: [
          issue("i1", "Set up the canvas", "in_progress"),
          issue("i2", "Draw the board", "done"),
        ],
      }),
      ggIssue("i1", { type: "issue_review", phase: "requested" }),
      ggIssue("i1", {
        type: "issue_review",
        phase: "changes_requested",
        reviewer: { agentId: "i1.0i.0r", profile: "critic" },
        items: ["Handle the empty-input case", "Add a unit test"],
      }),
      ggIssue("i2", { type: "issue_review", phase: "requested" }),
      ggIssue("i2", {
        type: "issue_review",
        phase: "approved",
        approvals: [{ agentId: "i2.0i.0r", profile: "critic" }],
      }),
    ];
    renderMonitor(events);
    openTab("Project");
    // Each review round is its own entry under the issue, so its feedback stays readable
    // after the issue has moved on — and the round says WHO ended it.
    openFile("i1 review 1");
    expect(screen.getByText("Changes Requested")).toBeInTheDocument();
    expect(screen.getByText("Changes requested by")).toBeInTheDocument();
    expect(screen.getByText("i1.0i.0r")).toBeInTheDocument();
    expect(screen.getByText("Handle the empty-input case")).toBeInTheDocument();
    expect(screen.getByText("Add a unit test")).toBeInTheDocument();
    // The second issue's round approved, which is what let it be accepted — and it names
    // the agents that approved.
    openFile("i2 review 1");
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Approved by")).toBeInTheDocument();
    expect(screen.getByText("i2.0i.0r")).toBeInTheDocument();
  });

  it("marks the chosen winner of a best-of-K speculation in the tree and summary", () => {
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
      sessionStarted(),
      attempt("agent-0"),
      attempt("agent-1"),
      attempt("agent-2"),
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
    openTab("Agents");
    // The speculation summary sits on the root's Overview (the default): best-of-3,
    // with the judge's rationale.
    expect(screen.getByText("best-of-3")).toBeInTheDocument();
    expect(
      screen.getByText("Cleanest overlay with a passing test."),
    ).toBeInTheDocument();
    // The winning attempt is starred in the sidebar tree.
    expect(screen.getByTitle("chosen best-of-K attempt")).toBeInTheDocument();
  });

  it("shows empty states when no gg telemetry arrives", () => {
    renderMonitor([]);
    // No session_started yet ⇒ Queued on the Dashboard.
    expect(screen.getByText("Queued")).toBeInTheDocument();
    // Dashboard and Agents are the unconditional tabs — the per-agent views live
    // inside Agents, not as their own capability-gated tabs. With no announced
    // capability set the run-global Project tab is not offered either.
    expect(
      screen.getByRole("radio", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Agents" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Project" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Context" })).toBeNull();
    // The Agents explorer still shows the root, whose activity waits on telemetry.
    openTab("Agents");
    openFile("root activity");
    expect(screen.getByText("Waiting for telemetry…")).toBeInTheDocument();
  });
});
