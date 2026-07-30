import { fireEvent, render, screen, within } from "@testing-library/react";
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
// per-configured-agent Agents panel, the per-instance Instances explorer, and — when the
// project-management capability is on — the run-global Project board. Everything a run lets
// you read about one running agent is a "file" inside that instance's folder in the
// Instances explorer, so reading an instance's activity, context, tasks, … starts by opening
// the Instances tab; the shared board is read on the Project tab.
function openTab(name: "Dashboard" | "Agents" | "Instances" | "Project") {
  fireEvent.click(screen.getByRole("radio", { name }));
}

// Open one file in an explorer. Each file row is labeled with the folder that holds it so
// it is unambiguous ("root activity", "agent-0 overview", "i3 overview").
function openFile(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

// Expand a folder. Only the run's root agent and the board's epics are open to begin with —
// a run fields dozens of instances and an epic a dozen issues, and all of it unfolded at
// once is a sidebar nobody can scan — so reading a file inside any other folder starts by
// opening it. Folder rows are labeled `agent <id>` / `issue <id>`.
function openFolder(name: string) {
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
    openTab("Instances");
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

  it("opens the run's root instance and no other, so a fleet stays scannable", () => {
    // A gg run routinely fields dozens of instances, each holding ten files: every folder
    // open is a sidebar of hundreds of rows, and the tree it is meant to show is unreadable.
    // So an instance is a closed folder you open, and the run's entry point is the one
    // already open.
    renderMonitor([
      sessionStarted(),
      gg({
        type: "agent_spawned",
        slot: "Root",
        modelId: "mock/scripted-builder",
        depth: 0,
      }),
      ggFrom("agent-0", "root", {
        type: "agent_spawned",
        slot: "Reviewer",
        modelId: "mock/scripted-builder",
        depth: 1,
      }),
    ]);
    openTab("Instances");
    // The root's files are there to read without a click...
    expect(
      screen.getByRole("button", { name: "root overview" }),
    ).toBeInTheDocument();
    // ...and the subagent is a folder, listed but closed, whose files appear once opened.
    const folder = screen.getByRole("button", { name: "agent agent-0" });
    expect(folder).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "agent-0 overview" }),
    ).toBeNull();
    fireEvent.click(folder);
    expect(
      screen.getByRole("button", { name: "agent-0 overview" }),
    ).toBeInTheDocument();
  });

  it("opens the board's epics and leaves their issues closed", () => {
    // The epics are the board's outline and say nothing closed; an issue is a folder holding
    // an Overview and a file per review round, and a decomposed epic's dozen of them
    // unfolded at once buries the outline they hang under.
    renderMonitor();
    openTab("Project");
    // The epic folder is open, so its issues are listed...
    expect(screen.getByText("i3: Add win overlay")).toBeInTheDocument();
    // ...as closed folders, whose own files appear only once opened.
    const issue = screen.getByRole("button", { name: "issue i3" });
    expect(issue).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "i3 overview" })).toBeNull();
    fireEvent.click(issue);
    expect(
      screen.getByRole("button", { name: "i3 overview" }),
    ).toBeInTheDocument();
  });

  it("renders the gg-native activity feed on an agent's activity file", () => {
    renderMonitor();
    openTab("Instances");
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
    openTab("Instances");
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
    openTab("Instances");
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
    openTab("Instances");
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
    openFolder("issue i3");
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
    // The Project sidebar is the same filesystem tree the Instances explorer is, and
    // its nesting is carried by a per-depth inline indent rather than by CSS (the
    // Agents tree nests arbitrarily deep). Without it every row lines up flush with
    // its folder and the tree reads as a flat list.
    renderMonitor();
    openTab("Project");
    openFolder("issue i3");
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
    openTab("Instances");
    openFile("root plan");
    expect(screen.getByText("Implementing")).toBeInTheDocument();
    expect(screen.getByText(/Scaffold the project/)).toBeInTheDocument();
  });

  it("renders skills and memories on an agent's knowledge file", () => {
    renderMonitor();
    openTab("Instances");
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
    openTab("Instances");
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
    openTab("Instances");
    openFolder("agent agent-0");
    expect(
      screen.getByRole("button", { name: "agent-0 tasks" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "root tasks" })).toBeNull();
    // And the file reads that agent's own list.
    openFile("agent-0 tasks");
    expect(screen.getByText("Draw the widget")).toBeInTheDocument();
  });

  it("names a board-dispatched issue agent by its issue, never “root”", () => {
    // The board auto-dispatches an issue to a **top-level** agent — parentless, depth 0
    // — whose id is minted from the issue itself (`WIDGET-1.0i`, its reviewers
    // `WIDGET-1.0i.0r`). Only the main agent is "root"; deciding that by parentlessness
    // called every dispatched agent "root" too, which is exactly the name that says
    // nothing about the work it was dispatched for.
    renderMonitor([
      sessionStartedWith([
        { name: "Root", capabilities: ["shell", "project-management"] },
        { name: "Coder", capabilities: ["shell", "tasks"] },
      ]),
      ggFrom("WIDGET-1.0i", undefined, {
        type: "agent_spawned",
        slot: "Coder",
        modelId: "mock/scripted-builder",
        depth: 0,
        brief: "Implement the widget.",
      }),
      ggFrom("WIDGET-1.0i", undefined, { type: "turn_started" }),
    ]);
    // The Dashboard's overview lists both agents, the dispatched one under its issue
    // name — and "root" names exactly one row, the main agent's.
    expect(screen.getByText("Agents · 2")).toBeInTheDocument();
    expect(screen.getByText("WIDGET-1.0i")).toBeInTheDocument();
    expect(screen.getAllByText("root")).toHaveLength(1);
    // Its meta line carries the profile it runs under and its own turn count. ("Coder"
    // reads twice on the Dashboard: the configuration card's profile, and this row's.)
    expect(screen.getAllByText("Coder")).toHaveLength(2);
    expect(screen.getByText("1 turn")).toBeInTheDocument();

    // Same on its own Overview in the explorer: the sidebar folder and the identity
    // card both name the issue, and the brief the board dispatched it with reads as a
    // dispatch rather than as a parent's hand-off.
    openTab("Instances");
    openFolder("agent WIDGET-1.0i");
    openFile("WIDGET-1.0i overview");
    expect(screen.getAllByText("WIDGET-1.0i").length).toBeGreaterThan(1);
    expect(screen.getByText("Implement the widget.")).toBeInTheDocument();
    openFile("WIDGET-1.0i prompt");
    expect(screen.getByText("Dispatch brief")).toBeInTheDocument();
    expect(screen.queryByText("Brief from parent")).toBeNull();
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
    // Named twice — the sidebar row and the detail the default landing selects — and both
    // read `ID: title`, the board's own name for the work.
    expect(
      screen.getAllByText("feat-1: Add the widget").length,
    ).toBeGreaterThan(0);
  });

  it("counts the session's turns beside the status, and each agent's own beneath its name", () => {
    // Two agents take three turns between them: the root twice, its child once.
    renderMonitor([
      sessionStarted(),
      gg({ type: "turn_started" }),
      ggFrom("agent-0", "root", {
        type: "agent_spawned",
        slot: "builder",
        modelId: "mock/scripted-builder",
        depth: 1,
        brief: "Build the overlay.",
      }),
      ggFrom("agent-0", "root", { type: "turn_started" }),
      gg({ type: "turn_started" }),
    ]);
    // The session's total is its own card at the top of the Dashboard — a run-level
    // fact, stated beside the status rather than tucked into the agents card.
    expect(screen.getByText("Turns")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("turns across 2 agents")).toBeInTheDocument();
    // …and the agents card carries only the count, with each agent's own turns under
    // its name instead of one summed figure.
    expect(screen.getByText("Agents · 2")).toBeInTheDocument();
    expect(screen.queryByText(/turns total/)).not.toBeInTheDocument();
    expect(screen.queryByText(/select one to open/)).not.toBeInTheDocument();
    expect(screen.getByText("2 turns")).toBeInTheDocument();
    expect(screen.getByText("1 turn")).toBeInTheDocument();
  });

  it("shows an agent's working directory and what it is waiting on", () => {
    // The root dispatches an issue agent into a worktree and suspends on that issue;
    // the child works in the worktree checkout, not the shared workspace.
    renderMonitor([
      sessionStarted(),
      gg({
        type: "agent_spawned",
        slot: "Root",
        modelId: "mock/scripted-builder",
        depth: 0,
        cwd: "/work/game",
      }),
      ggFrom("agent-0", "root", {
        type: "agent_spawned",
        slot: "Coder",
        modelId: "mock/scripted-builder",
        depth: 1,
        brief: "Implement the widget.",
        worktree: "gg/issue-1",
        cwd: "/work/game.gg-worktrees/issue-1",
      }),
      ggFrom("root", undefined, {
        type: "agent_status",
        status: "blocked",
        waitingOn: "issue `WIDGET-1.0`",
      }),
    ]);

    openTab("Instances");
    // The root's Overview (the default) says it is waiting, *what* on, and where it
    // is rooted — "waiting" alone reads the same as stuck.
    expect(screen.getByText("waiting")).toBeInTheDocument();
    expect(screen.getByText("waiting on")).toBeInTheDocument();
    expect(screen.getByText("issue `WIDGET-1.0`")).toBeInTheDocument();
    expect(screen.getByText("/work/game")).toBeInTheDocument();

    // The dispatched agent's directory is its worktree checkout: the branch chip says
    // which branch, the cwd says where on disk that is.
    openFolder("agent agent-0");
    openFile("agent-0 overview");
    expect(screen.getByText(/gg\/issue-1/)).toBeInTheDocument();
    expect(
      screen.getByText("/work/game.gg-worktrees/issue-1"),
    ).toBeInTheDocument();
    // A running agent is waiting for nothing, so it carries no condition.
    expect(screen.queryByText("waiting on")).not.toBeInTheDocument();
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
    // Where the money went is a whole-run cost fact, so it reads inside the Dashboard's
    // Cost widget: a bar per slot naming the model bound to it, and its cost both as the
    // widget's total and in its own row — so more than one node carries the figure.
    // ("reviewer" reads twice now — the per-slot row and the agent overview's slot
    // chip.)
    expect(screen.getByText("Per slot")).toBeInTheDocument();
    expect(screen.getAllByText("reviewer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("claude-haiku-4-8").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.0021").length).toBeGreaterThan(1);
    // And the same money read per model, always — here one model per slot, so it restates
    // the rows above rather than being withheld for saying nothing new.
    expect(screen.getByText("Per model")).toBeInTheDocument();

    openTab("Instances");
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
    openFolder("agent agent-0");
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
    openFolder("agent agent-1");
    openFile("agent-1 overview");
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("splits the running cost per slot and per model mid-run", () => {
    // Three slots on two models, mid-run: nothing has ended, so no `slot_usage` rollup
    // exists — the split comes from the attributed `usage` deltas alone. The same cheap
    // model is bound to two of the slots, which is what the per-model split is for.
    const events: HarnessEvent[] = [
      sessionStarted(),
      ggFrom("root", undefined, {
        type: "usage",
        slot: "root",
        modelId: "vendor/big",
        tokens: {
          uncachedInput: 4000,
          cachedInput: null,
          output: 500,
          reasoning: null,
        },
        cost: { comparable: 0.02, actual: 0.02 },
      }),
      ggFrom("agent-0", "root", {
        type: "usage",
        slot: "reviewer",
        modelId: "vendor/small",
        tokens: {
          uncachedInput: 2000,
          cachedInput: null,
          output: 100,
          reasoning: null,
        },
        cost: { comparable: 0.03, actual: 0.03 },
      }),
      ggFrom("agent-1", "root", {
        type: "usage",
        slot: "summarizer",
        modelId: "vendor/small",
        tokens: {
          uncachedInput: 1000,
          cachedInput: null,
          output: 50,
          reasoning: null,
        },
        cost: { comparable: 0.01, actual: 0.01 },
      }),
    ];
    renderMonitor(events);

    // Both splits read while the run is still going — no session_ended here.
    expect(screen.getByText("Per slot")).toBeInTheDocument();
    expect(screen.getByText("Per model")).toBeInTheDocument();
    // A row per slot, each naming the model it was bound to (the catalog is absent in
    // this bare render, so a model reads by its id).
    expect(screen.getByText("reviewer")).toBeInTheDocument();
    expect(screen.getByText("summarizer")).toBeInTheDocument();
    // The small model is bound to two slots, so it reads on both of their rows and again
    // as its own per-model row; the big model on one slot and its own row.
    expect(screen.getAllByText("vendor/small")).toHaveLength(3);
    expect(screen.getAllByText("vendor/big")).toHaveLength(2);
    // The per-model row sums the two slots the small model served: 0.03 + 0.01.
    expect(screen.getByText("$0.0400")).toBeInTheDocument();
    // …and the headline is every slot summed.
    expect(screen.getAllByText("$0.0600").length).toBeGreaterThan(0);
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

    // Clicking the reviewer's row switches to the Instances tab and lands on its Overview,
    // where its tool usage is broken down (grep, called once).
    fireEvent.click(screen.getByRole("button", { name: "Open agent-0" }));
    expect(screen.getByRole("radio", { name: "Instances" })).toBeChecked();
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

  it("sums a configured agent's instances on the Agents tab, and says what filled their windows", () => {
    // Two reviewers spawned off one Root, each reading the same specification and each
    // carrying it for the turns that follow. Per instance that is two unremarkable agents;
    // per *configured agent* it is the reviewer profile costing the run twice over — which
    // is the read this tab exists for.
    const spec = (agentId: string, id: string) =>
      ggFrom(agentId, "root", {
        type: "context_message",
        id,
        role: "tool",
        content: "the whole specification",
        toolCalls: [],
        images: [],
        tokens: 900,
        label: "specs/spec.md",
      });
    const request = (agentId: string, id: string) =>
      ggFrom(agentId, "root", {
        type: "prompt",
        request: [{ id, source: "file_view" }],
        totalTokens: 900,
        finishReason: "stop",
        tokens: {
          uncachedInput: 900,
          cachedInput: null,
          output: null,
          reasoning: null,
        },
      } as unknown as GgTelemetryKind);

    const events: HarnessEvent[] = [
      sessionStartedWith([
        { name: "Root", capabilities: ["subagents"] },
        { name: "reviewer", capabilities: ["filesystem"] },
      ]),
      gg({ type: "agent_spawned", slot: "Root", modelId: "mock/x", depth: 0 }),
      ...["agent-0", "agent-1"].flatMap((id, index) => [
        ggFrom(id, "root", {
          type: "agent_spawned",
          slot: "reviewer",
          modelId: "mock/x",
          depth: 1,
        }),
        ggFrom(id, "root", { type: "turn_started" }),
        ggFrom(id, "root", { type: "turn_started" }),
        ggFrom(id, "root", { type: "tool_call", name: "read_file", args: {} }),
        ggFrom(id, "root", {
          type: "usage",
          slot: "reviewer",
          modelId: "mock/x",
          tokens: {
            uncachedInput: 900 * (index + 1),
            cachedInput: null,
            output: 100,
            reasoning: null,
          },
        }),
        spec(id, `m-${index}`),
        request(id, `m-${index}`),
      ]),
    ];
    renderMonitor(events);
    openTab("Agents");

    // Both configured agents get a row, the reviewer's carrying both its instances rather
    // than one row apiece.
    expect(screen.getByText("Agents · 2")).toBeInTheDocument();
    const rows = screen.getAllByRole("button", { expanded: false });
    const reviewer = rows.find((row) => row.textContent?.includes("reviewer"));
    expect(reviewer).toBeDefined();
    // Closed, the row is the comparison line — two instances, four turns across them.
    expect(reviewer!.textContent).toContain("2instances");
    expect(reviewer!.textContent).toContain("4turns");

    // Every row starts closed, so the detail is not on the page until one is opened…
    expect(screen.queryByText("specs/spec.md")).toBeNull();
    fireEvent.click(reviewer!);
    expect(reviewer!).toHaveAttribute("aria-expanded", "true");

    // …and then it sums them: two instances, neither having reached a terminal state.
    expect(screen.getByText("2 running")).toBeInTheDocument();
    expect(screen.getByText("2.0 per instance")).toBeInTheDocument();

    // And the part no other view has: the material that filled their windows, attributed to
    // the file it came from and charged for every turn it sat there.
    expect(screen.getByText("specs/spec.md")).toBeInTheDocument();
    expect(screen.getByText(/resident 2 turns/)).toBeInTheDocument();

    // Opening one row opens only that row — the Root's detail is still folded away, so the
    // panel stays a list to compare down rather than becoming a stack of open cards.
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(1);

    // Each instance is a way back into its own files.
    fireEvent.click(screen.getByRole("button", { name: /Open agent-1/ }));
    expect(screen.getByRole("radio", { name: "Instances" })).toBeChecked();
    expect(screen.getByLabelText("agent-1 overview")).toBeInTheDocument();
  });

  it("states a profile's and an instance's own generation rate in their Tokens read-out", () => {
    // Two reviewer instances generating 200 tokens each: one spends 2s inside its model
    // (100 tok/s), the other 8s (25 tok/s). The profile's rate is its whole generation over
    // its whole model time — 400 tokens in 10s, so 40 tok/s — NOT the mean of its instances'
    // rates, which would claim 62 and describe no run that happened. Each instance still
    // reads its own rate on its Overview, which is where "which of them was slow" is
    // answered.
    const instance = (id: string, requestMs: number) => [
      ggFrom(id, "root", {
        type: "agent_spawned",
        slot: "reviewer",
        modelId: "mock/x",
        depth: 1,
      }),
      ggFrom(id, "root", { type: "turn_started" }),
      ggFrom(id, "root", {
        type: "usage",
        slot: "reviewer",
        modelId: "mock/x",
        tokens: {
          uncachedInput: 1000,
          cachedInput: null,
          output: 200,
          reasoning: null,
        },
      }),
      ggFrom(id, "root", {
        type: "turn_timing",
        promptMs: 5,
        requestMs,
        responseMs: 5,
      }),
    ];
    renderMonitor([
      sessionStartedWith([
        { name: "Root", capabilities: ["subagents"] },
        { name: "reviewer", capabilities: ["filesystem"] },
      ]),
      gg({ type: "agent_spawned", slot: "Root", modelId: "mock/x", depth: 0 }),
      ...instance("agent-0", 2000),
      ...instance("agent-1", 8000),
    ]);

    // The profile's rate, on the Tokens widget in its opened detail.
    openTab("Agents");
    const reviewer = screen
      .getAllByRole("button", { expanded: false })
      .find((row) => row.textContent?.includes("reviewer"));
    fireEvent.click(reviewer!);
    const profileRate = screen.getByText("tok/s").parentElement!;
    expect(within(profileRate).getByText("40")).toBeInTheDocument();

    // And one instance's own, on its Overview in the Instances explorer.
    openTab("Instances");
    openFolder("agent agent-0");
    openFile("agent-0 overview");
    const instanceRate = screen.getByText("tok/s").parentElement!;
    expect(within(instanceRate).getByText("100")).toBeInTheDocument();
  });

  it("folds an opened agent row back away when it is clicked again", () => {
    renderMonitor([
      sessionStarted(),
      gg({ type: "agent_spawned", slot: "Root", modelId: "mock/x", depth: 0 }),
      gg({ type: "turn_started" }),
    ]);
    openTab("Agents");

    const row = screen.getByRole("button", { expanded: false });
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("compactions")).toBeInTheDocument();

    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("compactions")).toBeNull();
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
    openTab("Instances");
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
    openTab("Instances");
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
          issue("i3", "Add the win overlay", "in_progress"),
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
      // i3's round is still open: its reviewers have the diff and no verdict has landed.
      ggIssue("i3", { type: "issue_review", phase: "requested" }),
    ];
    renderMonitor(events);
    openTab("Project");
    // Each review round is its own entry under the issue, so its feedback stays readable
    // after the issue has moved on — and the round says WHO ended it.
    openFolder("issue i1");
    openFile("i1 review 1");
    expect(screen.getByText("Changes requested by")).toBeInTheDocument();
    expect(screen.getByText("i1.0i.0r")).toBeInTheDocument();
    expect(screen.getByText("Handle the empty-input case")).toBeInTheDocument();
    expect(screen.getByText("Add a unit test")).toBeInTheDocument();
    // The second issue's round approved, which is what let it be accepted — and it names
    // the agents that approved.
    openFolder("issue i2");
    openFile("i2 review 1");
    expect(screen.getByText("Approved by")).toBeInTheDocument();
    expect(screen.getByText("i2.0i.0r")).toBeInTheDocument();
    // A round states its outcome by naming who reached it, so the header carries no
    // verdict badge repeating that in front of the title.
    expect(screen.queryByText("Changes Requested")).toBeNull();
    expect(screen.queryByText("Approved")).toBeNull();
    // The issue's own Overview does NOT repeat a round's feedback: each round is an entry
    // beside it, which is where that is read.
    openFile("i1 overview");
    expect(screen.queryByText("Handle the empty-input case")).toBeNull();
    // And an issue whose reviewers are on the diff right now reads "In Review", even
    // though the board snapshot still calls it in-progress.
    openFolder("issue i3");
    openFile("i3 overview");
    expect(screen.getByText("In Review")).toBeInTheDocument();
    expect(screen.queryByText("In Progress")).toBeNull();
  });

  it("heads an issue's Overview `ID: title` and renders its prose as Markdown", () => {
    const events: HarnessEvent[] = [
      sessionStarted(),
      gg({
        type: "board_state",
        epics: [],
        issues: [
          {
            id: "AUDIO-1",
            title: "Wire the audio",
            description: "Play a cue on **every** hit.",
            inScope: "- The hit cue\n- The win jingle",
            outOfScope: "",
            completionCriteria: "`api.audio()` reports both cues.",
            status: "in_progress",
            blockedBy: [],
            agent: "implementer",
            retries: 0,
          },
        ],
      }),
    ];
    renderMonitor(events);
    openTab("Project");
    openFolder("issue AUDIO-1");
    openFile("AUDIO-1 overview");
    // The header is the board's own name for the work — the id and the title as one line,
    // not the id orphaned onto a row of its own.
    expect(
      screen.getAllByText("AUDIO-1: Wire the audio").length,
    ).toBeGreaterThan(0);
    // The board's strings are the model's Markdown, so they render as Markdown: emphasis
    // is emphasis, a dashed list is a list, and a backticked identifier is code.
    expect(screen.getByText("every").tagName).toBe("STRONG");
    expect(screen.getByText("The win jingle").tagName).toBe("LI");
    expect(screen.getByText("api.audio()").tagName).toBe("CODE");
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
    openTab("Instances");
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
    // The Instances explorer still shows the root, whose activity waits on telemetry.
    openTab("Instances");
    openFile("root activity");
    expect(screen.getByText("Waiting for telemetry…")).toBeInTheDocument();
  });
});
