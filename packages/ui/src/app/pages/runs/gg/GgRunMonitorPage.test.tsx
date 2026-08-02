import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GgAgentModule,
  GgContextSource,
  GgContextSourceUsage,
  GgModuleKind,
  GgTelemetryEvent,
  GgTelemetryKind,
  GgTransitionModule,
} from "@test-cabinet/run-record/gg";
import type { RunRecord } from "@test-cabinet/run-record";
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

// The fixed source order the context breakdown always reports (zeros included), so a
// partial map fills out to a stable, ordered band set. Mirrors `GgContextSource::ALL`.
const SOURCE_ORDER: GgContextSource[] = [
  "system",
  "user_prompt",
  "assistant",
  "tool_output",
  "file_view",
  "text_view",
  "skill",
  "memory",
  "task_list",
  "board",
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

// One row of an `agent_transition`'s per-module list. A transition reports what
// happened to each module AND which instance is on each side of the boundary, so the
// four helpers below spell the four outcomes these fixtures need:
//
//   carried — the successor holds the very same store (one id, twice)
//   copied  — the copy holds an independent copy (two ids)
//   fresh   — the successor started an empty instance of its own
//   gone    — the store did not travel and is gone with the predecessor
function carried(kind: GgModuleKind, id: string): GgTransitionModule {
  return {
    kind,
    disposition: "carried",
    fromModuleId: id,
    toModuleId: id,
  };
}
function copied(
  kind: GgModuleKind,
  from: string,
  to: string,
): GgTransitionModule {
  return { kind, disposition: "copied", fromModuleId: from, toModuleId: to };
}
function fresh(kind: GgModuleKind, to: string): GgTransitionModule {
  return { kind, disposition: "initialized", toModuleId: to };
}
function gone(kind: GgModuleKind, from: string): GgTransitionModule {
  return { kind, disposition: "dropped", fromModuleId: from };
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
  "subagents",
  "multi-model",
  "workflows",
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
//
// A capability is named either bare (`"tasks"`, taking the capability's defaults) or as
// `[id, params]` — the params are how a configuration says what it *asked* for
// (`{ ownership: "unowned" }`, `{ scope: "shared" }`), which the module surfaces read as
// the declared half of every question they answer about what it actually got.
type CapabilitySpec = string | [string, Record<string, unknown>];
function sessionStartedWith(
  profiles: ReadonlyArray<{
    name: string;
    capabilities: ReadonlyArray<CapabilitySpec>;
  }>,
): HarnessEvent {
  return gg({
    type: "session_started",
    capabilitySet: {
      agents: profiles.map(({ name, capabilities }) => ({
        name,
        capabilities: capabilities.map((capability) => {
          const [id, params] = Array.isArray(capability)
            ? capability
            : [capability, {}];
          return { id, enabled: true, params };
        }),
        modelId: "mock/scripted-builder",
      })),
    },
  });
}

// One row of an agent instance's module roster (`agent_modules`) — the event every
// incarnation emits as it opens, naming the backing store it is a holder of. Everything
// not named takes the value an ordinary private, owned, writable module has.
function held(
  kind: GgModuleKind,
  moduleId: string,
  overrides: Partial<GgAgentModule> = {},
): GgAgentModule {
  return {
    kind,
    moduleId,
    enabled: true,
    ownership: "owned",
    origin: "created",
    writable: true,
    ...overrides,
  };
}

// The roster one instance reports. Two instances reporting the same module id are
// holding ONE store — which is the whole mechanism the module surfaces read.
function roster(
  agentId: string,
  modules: GgAgentModule[],
  parentAgentId?: string,
): HarnessEvent {
  return ggFrom(agentId, parentAgentId, {
    type: "agent_modules",
    modules,
  } as GgTelemetryKind);
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
    moduleId: "tasks-0",
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
    moduleId: "skills-0",
    skills: [
      { name: "gg-render", description: "How to draw.", read: true },
      { name: "gg-audio", description: "How to make sound.", read: false },
    ],
  }),
  gg({
    type: "memory_state",
    moduleId: "memories-0",
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
    // Shared with every instance of this agent, and writable — so the panel badges the
    // scope, which is the only way one store held by two agents is distinguishable from
    // two agents that happen to hold the same notes.
    scope: "shared",
    writable: true,
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
    moduleId: "board-0",
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
  // Phase 2: a compaction boundary (summarize-and-drop, honoring the retention
  // contract), the reclaimed post-compaction breakdown it drops to, and the agent
  // dropping material itself — one of each kind of view, which are different trades:
  // an evicted file view can be re-read, a closed agent view was its only copy.
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
  gg({
    type: "context_managed",
    action: "close_text_views",
    reclaimedTokens: 800,
    items: 1,
    detail: "Closed 1 agent view (changed-files), reclaiming ~800 tokens.",
  }),
  // A responses-as-code turn whose program printed. `console.*` never reaches the
  // model, so this event is the only record of what the program said and the feed is
  // where an operator reads it.
  gg({
    type: "code_execution",
    ok: true,
    toolCalls: 2,
    logs: ["checked 12 files", "3 of them changed"],
    logsSuppressed: 4,
  }),
  // A turn that printed nothing renders no row at all.
  gg({ type: "code_execution", ok: true, toolCalls: 1 }),
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

// The same worker, but the run finishes: it replays the events and then completes with
// a produced run, so the page reaches its terminal-outcome notice.
function completingWorkersValue(events: HarnessEvent[]): WorkersContextValue {
  const client = {
    subscribeToRun: (_runId: string, handlers: RunSubscription) => {
      for (const event of events) handlers.onEvent(event);
      // The notice reads only the produced run's id and state.
      handlers.onDone({
        kind: "completed",
        record: {
          id: "run-1",
          status: { state: "passed" },
        } as unknown as RunRecord,
      });
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

function renderMonitor(
  events: HarnessEvent[] = EVENTS,
  workers: (events: HarnessEvent[]) => WorkersContextValue = workersValue,
) {
  return render(
    <MemoryRouter initialEntries={["/runs/gg/job-1/live"]}>
      <WorkersProvider value={workers(events)}>
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
function openTab(
  name: "Dashboard" | "Agents" | "Instances" | "Modules" | "Project",
) {
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

// The value of one module figure, read by the row it sits in and its own label. Every
// module surface states its numbers in the same tile — a large value over a muted label
// — so a bare `getByText` on the figure would match any number anywhere on the panel;
// the labeled group is what makes it the *store's* count.
function statValue(group: string, label: string): string {
  const row = screen.getByRole("group", { name: group });
  return within(row).getByText(label).previousElementSibling!.textContent!;
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
      "root requests",
      "root metrics",
    ]) {
      expect(screen.getByRole("button", { name: file })).toBeInTheDocument();
    }
    // The state the agent *holds* is not among its files: a module instance can be
    // shared with other instances, carried to a successor or copied by a fork, so it is
    // read as a store with holders rather than as a property of one agent. It lives one
    // folder down, closed by default.
    const folder = screen.getByRole("button", { name: "root modules" });
    expect(folder).toHaveAttribute("aria-expanded", "false");
    for (const file of ["root tasks", "root knowledge", "root board"]) {
      expect(screen.queryByRole("button", { name: file })).toBeNull();
    }
    // Opened, it lists one row per module this instance holds, in the contract's kind
    // order — every instance has a window, and this run's configuration gives it the
    // rest.
    fireEvent.click(folder);
    for (const module of [
      "root modules history",
      "root modules memories",
      "root modules tasks",
      "root modules board",
      "root modules skills",
    ]) {
      expect(screen.getByRole("button", { name: module })).toBeInTheDocument();
    }
    // Agent-managed context is off for this run, so it holds no archive.
    expect(
      screen.queryByRole("button", { name: "root modules archive" }),
    ).toBeNull();
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
    // The agent closing a view it composed reads as its own row, labelled apart from an
    // eviction — `contextActionLabel` is exhaustive, so a new action lands here or nowhere.
    expect(
      screen.getByText(
        "Closed 1 agent view (changed-files), reclaiming ~800 tokens.",
      ),
    ).toBeInTheDocument();
    // A program's own output. It is not shown to the model — a view is the channel into
    // the window — so the turn's `code_execution` event is its ONLY record, and the feed
    // is where the operator reads it. The capture cap is disclosed rather than leaving a
    // truncated list to read as a program that stopped printing.
    // Twice: a collapsible row renders a one-line preview AND the full body.
    expect(screen.getAllByText(/checked 12 files/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "2 lines · 4 earlier lines dropped by the capture cap",
      ),
    ).toBeInTheDocument();
    // A turn that printed nothing adds no row: the program itself is already visible as
    // the assistant message that carried it.
    expect(screen.getAllByText("OUTPUT")).toHaveLength(1);
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

  it("renders the task DAG on an agent's tasks module", () => {
    renderMonitor();
    openTab("Instances");
    openFolder("root modules");
    openFile("root modules tasks");
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

  it("reads a window module by the messages that are in it", () => {
    // A window's contents ARE its messages. The file used to say what a conversation
    // window is in a paragraph, state two counts, and send the reader elsewhere for the
    // one thing it holds — the only module file that answered its own question with a
    // link. It now carries the message log itself, the way the Requests file does.
    renderMonitor([
      sessionStarted(["shell", "tasks"]),
      roster("root", [held("history", "history-0"), held("tasks", "tasks-0")]),
      gg({
        type: "context_message",
        id: "s",
        role: "system",
        content: "You are building a game.",
        toolCalls: [],
        images: [],
        tokens: 8,
      }),
      gg({ type: "turn_started" }),
      gg({
        type: "prompt",
        request: [{ id: "s", source: "system" }],
        totalTokens: 8,
        finishReason: "stop",
        tokens: {
          uncachedInput: 8,
          cachedInput: 0,
          output: 0,
          reasoning: null,
        },
      }),
    ]);
    openTab("Instances");
    openFolder("root modules");
    openFile("root modules history");

    // How much of the run the window has seen, as figures rather than a label/value list.
    expect(statValue("Window", "turns")).toBe("1");
    expect(statValue("Window", "messages")).toBe("1");
    // And the messages themselves — the newest turn open, its one system message in it
    // (named twice: the collapsed row's preview and the expanded body).
    const messages = screen.getByRole("region", { name: "Messages" });
    expect(within(messages).getByText("Turn 1")).toBeInTheDocument();
    expect(
      within(messages).getAllByText("You are building a game.").length,
    ).toBeGreaterThan(0);

    // The same store read as a store, on the Modules tab, shows the same contents —
    // a window used to be the one kind whose detail there had nothing in it.
    openTab("Modules");
    openFolder("history modules");
    fireEvent.click(screen.getByRole("button", { name: "module history-0" }));
    const onModulesTab = screen.getByRole("region", { name: "Messages" });
    expect(
      within(onModulesTab).getAllByText("You are building a game.").length,
    ).toBeGreaterThan(0);
  });

  it("splits skills and memories into two module files", () => {
    // They used to share one Knowledge file, which was a forced join: they are gated
    // independently and shared on entirely different terms — a fork copies the skills
    // read set with the window, while memories can be linked across agents — so one
    // file could never say whose either of them was.
    renderMonitor();
    openTab("Instances");
    openFolder("root modules");
    openFile("root modules skills");
    expect(screen.getByText("gg-render")).toBeInTheDocument();
    // The store's figures, in the shape every module states them in: two offered, one
    // of them read.
    expect(statValue("Skills", "offered")).toBe("2");
    expect(statValue("Skills", "read")).toBe("1");
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    // The memories are their own file, and reading it does not carry the skills along.
    openFile("root modules memories");
    expect(screen.queryByText("gg-render")).toBeNull();
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
    expect(screen.getByText("characters")).toBeInTheDocument();
    expect(screen.getByText("peak 300")).toBeInTheDocument();
    expect(screen.getByText("peak 9")).toBeInTheDocument();
    // The retention note says this module's contents survived the compaction verbatim —
    // now named for the one module the file is about rather than for both halves.
    expect(
      screen.getByText(
        "Retained verbatim across 1 compaction — the memories carried over.",
      ),
    ).toBeInTheDocument();
  });

  it("offers a file and a module for every enabled capability, even before it has data", () => {
    // A narrow run: tasks + memories on, and NO tasks/memory events have arrived
    // yet. What an agent's folder offers is gated by the run's configuration, not by
    // whether data has streamed — so the `tasks` and `memories` modules are present
    // (showing their own empty state), Context is unconditional, and the capabilities
    // the run lacks (compaction, project management) offer nothing at all.
    renderMonitor([
      sessionStarted(["shell", "tasks", "memories"]),
      gg({ type: "assistant_message", text: "Working." }),
    ]);
    openTab("Instances");
    for (const file of ["root overview", "root activity", "root context"]) {
      expect(screen.getByRole("button", { name: file })).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: "root compaction" }),
    ).toBeNull();
    openFolder("root modules");
    for (const module of [
      "root modules history",
      "root modules tasks",
      "root modules memories",
    ]) {
      expect(screen.getByRole("button", { name: module })).toBeInTheDocument();
    }
    for (const module of [
      "root modules board",
      "root modules skills",
      "root modules archive",
    ]) {
      expect(screen.queryByRole("button", { name: module })).toBeNull();
    }
    // With project-management off there is also no Project tab.
    expect(screen.queryByRole("radio", { name: "Project" })).toBeNull();
    // An enabled-but-empty module is present and shows its own "nothing yet" state,
    // rather than being hidden until data arrives.
    openFile("root modules tasks");
    expect(screen.getByText(/No tasks yet/)).toBeInTheDocument();
  });

  it("gives an instance whose profile holds no capability its window and nothing else", () => {
    // Every agent has a conversation window, always — it has no capability behind it and
    // cannot be turned off — so the modules folder is never empty. A shell-only agent's
    // folder is the floor: one `history` row, and none of the stores it was never given.
    renderMonitor([
      sessionStarted(["shell", "filesystem"]),
      gg({ type: "assistant_message", text: "Working." }),
    ]);
    openTab("Instances");
    openFolder("root modules");
    expect(
      screen.getByRole("button", { name: "root modules history" }),
    ).toBeInTheDocument();
    for (const module of [
      "root modules memories",
      "root modules tasks",
      "root modules board",
      "root modules skills",
      "root modules archive",
    ]) {
      expect(screen.queryByRole("button", { name: module })).toBeNull();
    }
    // And the window's own file reads the window: how much of the run it has seen, over
    // the messages that are in it — rather than a paragraph about what a window is and
    // two links out to the files that answer it.
    openFile("root modules history");
    expect(statValue("Window", "turns")).toBe("0");
    expect(statValue("Window", "compactions")).toBe("0");
    expect(
      screen.getByRole("region", { name: "Messages" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/conversation window/)).toBeNull();
  });

  it("offers each agent the modules its own profile justifies, not the Root's", () => {
    // The ordinary shape of a board run: the Root files work and keeps no task list;
    // the `Coder` profile an issue dispatches under keeps one and files nothing.
    // Reading the Root's configuration for every folder hid the task list on exactly
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
        moduleId: "tasks-0",
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
    openFolder("agent-0 modules");
    expect(
      screen.getByRole("button", { name: "agent-0 modules tasks" }),
    ).toBeInTheDocument();
    // The Root holds a board and no task list; its folder says so.
    openFolder("root modules");
    expect(
      screen.queryByRole("button", { name: "root modules tasks" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "root modules board" }),
    ).toBeInTheDocument();
    // And the file reads that agent's own list.
    openFile("agent-0 modules tasks");
    expect(screen.getByText("Draw the widget")).toBeInTheDocument();
  });

  it("marks a shared module in the tree and walks between its holders", () => {
    // The distinction the whole modules folder exists for: two instances of one profile
    // curating ONE notebook, against two instances that happen to have written the same
    // notes. They are indistinguishable in every per-agent view — same panel, same
    // entries — and the difference is the difference between "the shared-memory arm is
    // working" and "it silently fell back to private notebooks". So the store's identity
    // is what the folder is keyed on: both reviewers report `memories-1`.
    renderMonitor([
      sessionStartedWith([
        { name: "Root", capabilities: ["shell", "subagents", "memories"] },
        {
          name: "Reviewer",
          capabilities: [["memories", { scope: "shared" }]],
        },
      ]),
      roster("root", [
        held("history", "history-0"),
        held("memories", "memories-0"),
      ]),
      ggFrom("agent-0", "root", {
        type: "agent_spawned",
        slot: "Reviewer",
        modelId: "mock/scripted-builder",
        depth: 1,
      }),
      roster(
        "agent-0",
        [
          held("history", "history-1"),
          held("memories", "memories-1", {
            scope: "shared",
            origin: "profile",
          }),
        ],
        "root",
      ),
      ggFrom("agent-1", "root", {
        type: "agent_spawned",
        slot: "Reviewer",
        modelId: "mock/scripted-builder",
        depth: 1,
      }),
      roster(
        "agent-1",
        [
          held("history", "history-2"),
          held("memories", "memories-1", {
            scope: "shared",
            origin: "profile",
          }),
        ],
        "root",
      ),
      // One store, so one content — written by whichever holder happened to write it.
      ggFrom("agent-0", "root", {
        type: "memory_state",
        moduleId: "memories-1",
        strategy: "scratchpad",
        memories: [
          {
            name: "review-standards",
            description: "What we reject for.",
            len: 40,
            lines: 2,
          },
        ],
        count: 1,
        totalLen: 40,
        totalLines: 2,
        peak: { count: 1, totalLen: 40, totalLines: 2 },
        caps: {
          maxCount: null,
          maxLenPerMemory: null,
          maxTotalLen: null,
          maxLenIndex: null,
          maxLenDescription: null,
          maxResults: null,
        },
        scope: "shared",
        writable: true,
      }),
    ]);
    openTab("Instances");
    openFolder("agent agent-0");
    openFolder("agent-0 modules");
    // Sharing is marked in the tree, so it reads without opening anything.
    const row = screen.getByRole("button", {
      name: "agent-0 modules memories",
    });
    expect(within(row).getByText("2 holders")).toBeInTheDocument();
    // The root's own notebook is a different store, and says so.
    openFolder("root modules");
    expect(
      within(
        screen.getByRole("button", { name: "root modules memories" }),
      ).queryByText(/holders/),
    ).toBeNull();

    // The file names the store, states how it is shared, and offers its co-holder.
    openFile("agent-0 modules memories");
    expect(screen.getByText("memories-1")).toBeInTheDocument();
    expect(
      screen.getByText("shared by 2 holders of Reviewer", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("review-standards").length).toBeGreaterThan(0);

    // And the co-holder chip walks to the same store read from the other instance: its
    // own folder is opened on the way, its module file is selected, and the contents are
    // the same because the store is the same one.
    fireEvent.click(screen.getByRole("button", { name: "agent-1" }));
    expect(
      screen.getByRole("button", { name: "agent-1 modules memories" }),
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getAllByText("review-standards").length).toBeGreaterThan(0);
    // From there the chip points back the other way.
    expect(screen.getByRole("button", { name: "agent-0" })).toBeInTheDocument();
  });

  it("says when a module is held but kept out of the prompt", () => {
    // `unowned` is the one capability setting whose effect is invisible everywhere else:
    // the tools are offered, the store is read and written, the telemetry arrives — the
    // module just never reaches the model's window. So the module file states it as a
    // sentence rather than leaving a badge to be interpreted.
    renderMonitor([
      sessionStartedWith([
        {
          name: "Root",
          capabilities: ["shell", ["tasks", { ownership: "unowned" }]],
        },
      ]),
      roster("root", [
        held("history", "history-0"),
        held("tasks", "tasks-0", { ownership: "unowned" }),
      ]),
    ]);
    openTab("Instances");
    openFolder("root modules");
    openFile("root modules tasks");
    expect(screen.getByText("unowned")).toBeInTheDocument();
    expect(
      screen.getByText(/its prompt does not carry it/),
    ).toBeInTheDocument();
  });

  it("links an agent's board module through to the board itself", () => {
    // The board is one thing the whole run shares, so a per-agent board file would be a
    // second rendering of it. What the module file adds is the part the Project tab
    // cannot say — that this agent holds a handle on it — and it hands the reader on.
    renderMonitor();
    openTab("Instances");
    openFolder("root modules");
    openFile("root modules board");
    // The decomposition tallied in the board's own vocabulary, not redrawn.
    expect(screen.getByText("1 Approved")).toBeInTheDocument();
    expect(screen.queryByText("Set up the canvas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open the board" }));
    expect(screen.getByRole("radio", { name: "Project" })).toBeChecked();
    expect(screen.getByText("i1: Set up the canvas")).toBeInTheDocument();
  });

  // --- The Modules tab -------------------------------------------------------

  // A run built to be read by module rather than by agent, exercising every relation a
  // store can stand in: TWO Reviewer instances curating ONE profile-scoped notebook
  // (`memories-1`), a Root with a private notebook of its own (`memories-0`), and a Root
  // that then `exec`s — carrying its window and its task list to the successor and
  // dropping its notebook on the way. Read per agent that is five unremarkable panels;
  // read per module it is one shared store, one dropped one, and two carried ones.
  function moduleRun(): HarnessEvent[] {
    return [
      sessionStartedWith([
        {
          name: "Root",
          capabilities: ["shell", "subagents", "memories", "tasks"],
        },
        { name: "Reviewer", capabilities: [["memories", { scope: "shared" }]] },
      ]),
      roster("root", [
        held("history", "history-0"),
        held("memories", "memories-0"),
        held("tasks", "tasks-0"),
      ]),
      ggFrom("agent-0", "root", {
        type: "agent_spawned",
        slot: "Reviewer",
        modelId: "mock/scripted-builder",
        depth: 1,
      }),
      roster(
        "agent-0",
        [
          held("history", "history-1"),
          held("memories", "memories-1", {
            scope: "shared",
            origin: "profile",
          }),
        ],
        "root",
      ),
      ggFrom("agent-1", "root", {
        type: "agent_spawned",
        slot: "Reviewer",
        modelId: "mock/scripted-builder",
        depth: 1,
      }),
      roster(
        "agent-1",
        [
          held("history", "history-2"),
          held("memories", "memories-1", {
            scope: "shared",
            origin: "profile",
          }),
        ],
        "root",
      ),
      // One store, so one content — written by whichever holder happened to write it.
      ggFrom("agent-0", "root", {
        type: "memory_state",
        moduleId: "memories-1",
        strategy: "scratchpad",
        memories: [
          {
            name: "review-standards",
            description: "What we reject for.",
            len: 40,
            lines: 2,
          },
        ],
        count: 1,
        totalLen: 40,
        totalLines: 2,
        peak: { count: 1, totalLen: 40, totalLines: 2 },
        caps: {
          maxCount: null,
          maxLenPerMemory: null,
          maxTotalLen: null,
          maxLenIndex: null,
          maxLenDescription: null,
          maxResults: null,
        },
        scope: "shared",
        writable: true,
      }),
      // What that shared block costs each window carrying it — the rent both holders pay
      // every turn, which is the figure the whole tab exists to make addable.
      ggFrom("agent-0", "root", {
        type: "context_breakdown",
        bySource: bySource({ system: 1000, memory: 800 }),
        totalTokens: 1800,
        windowLimit: 200000,
        fullness: 0.009,
      }),
      ggFrom("agent-1", "root", {
        type: "context_breakdown",
        bySource: bySource({ system: 1000, memory: 600 }),
        totalTokens: 1600,
        windowLimit: 200000,
        fullness: 0.008,
      }),
      // The Root hands off: its window and its task list travel, its notebook does not.
      gg({
        type: "agent_transition",
        kind: "exec",
        toAgentId: "agent-2",
        agent: "Root",
        modules: [
          carried("history", "history-0"),
          gone("memories", "memories-0"),
          carried("tasks", "tasks-0"),
        ],
      }),
      ggFrom("agent-2", "root", {
        type: "agent_spawned",
        slot: "Root",
        modelId: "mock/scripted-builder",
        depth: 0,
      }),
      roster(
        "agent-2",
        [
          held("history", "history-0", { origin: "transferred" }),
          held("tasks", "tasks-0", { origin: "transferred" }),
        ],
        "root",
      ),
    ];
  }

  it("offers the Modules tab only for a run that holds modules", () => {
    // A shell-and-filesystem run holds one window per instance and nothing else, and a
    // tab that can only ever list those is worse than no tab at all.
    renderMonitor([
      sessionStarted(["shell", "filesystem"]),
      gg({ type: "assistant_message", text: "Working." }),
    ]);
    expect(screen.queryByRole("radio", { name: "Modules" })).toBeNull();
    expect(
      screen.getByRole("radio", { name: "Instances" }),
    ).toBeInTheDocument();
  });

  it("groups module instances by kind, and a shared store appears once", () => {
    // The distinction the tab exists for. Two Reviewer instances hold ONE notebook, so
    // it is ONE row with two holders — not a row per holder, which is exactly how every
    // per-agent view has to show it and exactly what makes a shared store indistinguishable
    // from two agents that happen to agree.
    renderMonitor(moduleRun());
    openTab("Modules");
    // Kind folders open by default — they are grouping folders whose children are leaves…
    expect(
      screen.getByRole("button", { name: "memories modules" }),
    ).toHaveAttribute("aria-expanded", "true");
    // …except history, which is one instance per agent by construction and so the longest
    // and least surprising group in every run.
    expect(
      screen.getByRole("button", { name: "history modules" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "module history-1" }),
    ).toBeNull();

    // The shared store: one row, two holders, marked as shared in the tree.
    const shared = screen.getAllByRole("button", { name: "module memories-1" });
    expect(shared).toHaveLength(1);
    expect(within(shared[0]!).getByText("2 holders")).toBeInTheDocument();
    // Its trailing annotation names whose it is — the profile every instance of which
    // binds it.
    expect(within(shared[0]!).getByText("Reviewer")).toBeInTheDocument();
    // The Root's own notebook is a different store, held by one instance and dropped by
    // the succession that left it behind.
    const priv = screen.getByRole("button", { name: "module memories-0" });
    expect(within(priv).getByText("1 holder")).toBeInTheDocument();
    expect(within(priv).getByText("(dropped)")).toBeInTheDocument();
  });

  it("leads each kind with a whole-run read-out of how it is being used", () => {
    // The tab's headline question is asked one capability at a time — "is this being used
    // the way it was configured to be, and is it earning its keep?" — and it is only
    // answerable with every store of that kind side by side.
    renderMonitor(moduleRun());
    openTab("Modules");
    // The landing is the first non-history group's Overview: two memory stores between
    // three holds of them.
    expect(screen.getByText("Memories")).toBeInTheDocument();
    // Stated once, as figures. The heading used to trail the same two counts as prose
    // one line above the stats that carry them.
    expect(statValue("Usage", "instances")).toBe("2");
    expect(statValue("Usage", "holders")).toBe("3");
    expect(screen.queryByText("2 instances · 3 holders")).toBeNull();
    // How widely: one of the two stores is shared, and the widest is held by two — and
    // the other one was never written to at all, which is the other half of "is this
    // capability being used".
    expect(screen.getByText("widest: 2 holders")).toBeInTheDocument();
    // Twice: the "holding nothing" stat's sub-label, and the untouched store's own row in
    // the distribution — where an empty cell would read the same as a kind that reports no
    // contents at all.
    expect(screen.getAllByText("never written to")).toHaveLength(2);
    expect(screen.getAllByText("1 of 2")).toHaveLength(2);
    // The rent, summed the way it is actually paid: both live holders re-send the shared
    // block every turn, so it costs 800 + 600 — across the two windows that reported one,
    // not across all three holds (an unreported window pays an unknown rent, not a zero).
    expect(screen.getByText("1.4k")).toBeInTheDocument();
    expect(screen.getByText("across 2 windows")).toBeInTheDocument();
    // And the distribution: each store, whose it is, who holds it, and what it holds.
    expect(screen.getByText("agent-0 · agent-1")).toBeInTheDocument();
    expect(screen.getByText("1 memory · 40 chars")).toBeInTheDocument();
  });

  it("reads one store's holders, lifetime and cost, and links back to its holders", () => {
    renderMonitor(moduleRun());
    openTab("Modules");
    fireEvent.click(screen.getByRole("button", { name: "module memories-1" }));

    // Who is in it, and how each of them came by it — the section the tab exists for.
    expect(screen.getByText("Holders · 2")).toBeInTheDocument();
    expect(screen.getAllByText("bound Reviewer's store")).toHaveLength(2);
    expect(screen.getAllByText("read/write").length).toBeGreaterThan(0);
    // What it costs each of those windows, and what that adds up to across them.
    expect(screen.getByText("800")).toBeInTheDocument();
    expect(screen.getByText("600")).toBeInTheDocument();
    expect(
      screen.getByText(/tokens every turn across 2 live holders/),
    ).toBeInTheDocument();
    // And its contents, ONCE — from the store's own snapshot rather than from either
    // holder's slice.
    expect(screen.getAllByText("review-standards").length).toBeGreaterThan(0);

    // A holder's id hands the reader through to that instance's own file for this
    // module: the same store, read from inside the agent holding it.
    fireEvent.click(screen.getByRole("button", { name: "agent-1" }));
    expect(screen.getByRole("radio", { name: "Instances" })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "agent-1 modules memories" }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("shows a store's whole life, oldest first", () => {
    // A store's id alone cannot say which instance made it, which was handed it, and
    // which merely got a link — and those are the differences between a succession, a
    // fork and a shared binding.
    renderMonitor(moduleRun());
    openTab("Modules");
    openFolder("history modules");
    fireEvent.click(screen.getByRole("button", { name: "module history-0" }));
    const lifetime = screen.getByRole("region", { name: "Lifetime" });
    expect(
      within(lifetime)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining("created by root"),
      expect.stringContaining("carried to agent-2 by exec"),
    ]);
    // The notebook that did NOT travel says so, and is badged dropped.
    fireEvent.click(screen.getByRole("button", { name: "module memories-0" }));
    expect(
      screen.getByText("dropped by root on exec", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText("dropped")).toBeInTheDocument();
  });

  it("walks between an instance's module file and the store itself", () => {
    // The two directions of the same question: "what is this agent holding" (the
    // Instances tab) and "who is holding this store" (here). Each hands the reader to the
    // other in one click.
    renderMonitor(moduleRun());
    openTab("Instances");
    openFolder("agent agent-0");
    openFolder("agent-0 modules");
    openFile("agent-0 modules memories");
    fireEvent.click(screen.getByRole("button", { name: "Open in Modules" }));
    expect(screen.getByRole("radio", { name: "Modules" })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "module memories-1" }),
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Holders · 2")).toBeInTheDocument();
  });

  it("hands a holder's profile through to the Agents tab", () => {
    // A holder is an instance *of* something, and "is this how that arm is meant to be
    // sharing?" is a question about the profile rather than about the instance. The row
    // it lands on is opened, since every row on that tab starts closed.
    renderMonitor(moduleRun());
    openTab("Modules");
    fireEvent.click(screen.getByRole("button", { name: "module memories-1" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Reviewer" })[0]!);
    expect(screen.getByRole("radio", { name: "Agents" })).toBeChecked();
    expect(
      screen.getByRole("region", { name: "Reviewer detail" }),
    ).toBeInTheDocument();
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
    // management on a dedicated board-owning profile still has a board to read.
    renderMonitor([
      sessionStartedWith([
        { name: "Root", capabilities: ["shell", "subagents"] },
        { name: "Planner", capabilities: ["shell", "project-management"] },
      ]),
      gg({
        type: "board_state",
        moduleId: "board-0",
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
      ggFrom("agent-0", "root", { type: "turn_started" }),
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
    // …alongside how much it got out of each response: one call in its one turn.
    expect(screen.getByText("1.0 calls per response")).toBeInTheDocument();

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

    // And the efficiency read: two read_file calls across the four responses the two
    // instances made between them, so half a call a response — the profile's calls over
    // the profile's responses, not the mean of its instances' own rates. It shows twice,
    // once on the comparison line the row still carries while open and once in the
    // detail's stat grid.
    expect(screen.getAllByText("0.5")).toHaveLength(2);
    expect(screen.getByText("2 calls · 4 responses")).toBeInTheDocument();

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

  // --- Agent-scoped module state ----------------------------------------------
  //
  // A profile's row is a sum of its instances, and module state is the one thing on it that
  // does not sum: twelve instances may be reading ONE store or twelve, and which of those it
  // is *is* the configuration under test. So the section states the distribution, shows the
  // contents only for the one shape whose contents belong to the agent, and says plainly
  // when there is no such shape rather than leaving an empty box behind.

  // Open one configured agent's row on the Agents tab (every row starts closed).
  function openAgentRow(name: string) {
    const row = screen
      .getAllByRole("button", { expanded: false })
      .find((candidate) => candidate.textContent?.includes(name));
    fireEvent.click(row!);
    return row!;
  }

  it("shows a profile's shared store once, as the agent's own", () => {
    // Two Reviewer instances curate ONE notebook, so at the profile's grain there is a
    // single store and its contents ARE the reviewer's. This is the case the user asked for
    // — and it is legitimate here precisely because there is nothing to aggregate.
    renderMonitor(moduleRun());
    openTab("Agents");
    openAgentRow("Reviewer");

    // The distribution first: one store, both instances, and what the two windows pay for
    // it between them every turn.
    const memories = screen.getByRole("region", { name: "Reviewer memories" });
    expect(within(memories).getByText("agent-scoped")).toBeInTheDocument();
    expect(
      within(memories).getByText("1 store · 2 of 2 instances · 1.4k/turn"),
    ).toBeInTheDocument();
    expect(
      within(memories).getByText(
        /One store — memories-1 — bound by 2 instances/,
      ),
    ).toBeInTheDocument();

    // And the contents, framed so it is unmistakable that they are the agent's rather than
    // one instance's — which is the whole risk of putting store-shaped state on this row.
    const scoped = within(memories).getByRole("region", {
      name: "Reviewer agent-scoped memories",
    });
    expect(
      within(scoped).getByText(/read here once for the whole agent/),
    ).toBeInTheDocument();
    expect(
      within(scoped).getAllByText("review-standards").length,
    ).toBeGreaterThan(0);

    // A window, by contrast, is never shared — so the same profile's history row is one
    // store per instance and shows no contents at all.
    const history = screen.getByRole("region", { name: "Reviewer history" });
    expect(within(history).getByText("per instance")).toBeInTheDocument();
    expect(
      within(history).getByText(/every instance's history is its own/),
    ).toBeInTheDocument();
  });

  it("says an isolated profile has no agent-scoped state rather than showing nothing", () => {
    // The ablation's off arm. Two Reviewer instances, `isolated` memories, two stores: any
    // rendering of either one as "the reviewer's memories" would be a lie about the other,
    // so the row states that, states how much of the capability went unused, and hands the
    // reader to the surface where N stores are compared.
    renderMonitor([
      sessionStartedWith([
        { name: "Root", capabilities: ["shell", "subagents"] },
        { name: "Reviewer", capabilities: ["memories"] },
      ]),
      roster("root", [held("history", "history-0")]),
      ...["agent-0", "agent-1"].map((id, index) =>
        ggFrom(id, "root", {
          type: "agent_spawned",
          slot: "Reviewer",
          modelId: "mock/scripted-builder",
          depth: 1,
          brief: `Review ${index}.`,
        }),
      ),
      roster(
        "agent-0",
        [held("history", "history-1"), held("memories", "memories-0")],
        "root",
      ),
      roster(
        "agent-1",
        [held("history", "history-2"), held("memories", "memories-1")],
        "root",
      ),
    ]);
    openTab("Agents");
    openAgentRow("Reviewer");

    const memories = screen.getByRole("region", { name: "Reviewer memories" });
    expect(
      within(memories).getByText("2 stores · 2 of 2 instances"),
    ).toBeInTheDocument();
    expect(
      within(memories).getByText(/every instance's memories is its own/),
    ).toBeInTheDocument();
    // No agent-scoped frame at all — not an empty one.
    expect(
      screen.queryByRole("region", { name: "Reviewer agent-scoped memories" }),
    ).toBeNull();
    // And the read-out that says whether the capability was used at all: neither store was
    // ever written to.
    expect(
      within(memories).getByText("2 of 2 stores never written to"),
    ).toBeInTheDocument();
  });

  it("walks from a profile's modules out to the stores and the instances holding them", () => {
    renderMonitor(moduleRun());
    openTab("Agents");
    openAgentRow("Reviewer");

    // A holder of the agent-scoped store opens that instance's own file for it — the same
    // store, read from inside one of the agents in it.
    fireEvent.click(screen.getByRole("button", { name: "agent-1" }));
    expect(screen.getByRole("radio", { name: "Instances" })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "agent-1 modules memories" }),
    ).toHaveAttribute("aria-current", "true");

    // And the module row *itself* hands the reader to the kind's whole-run read-out, which
    // is where several stores of one kind are actually comparable. The target is the whole
    // row rather than a button inside it, so the Reviewer's `history` row (two stores, one
    // per instance) is reached by its destination rather than by a label it shares with
    // every other row. This is the keyboard's half of it: an overlay laid on the row's
    // inset, carrying the name and the focus ring.
    openTab("Agents");
    openAgentRow("Reviewer");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Compare history across instances in Modules",
      }),
    );
    expect(screen.getByRole("radio", { name: "Modules" })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "history overview" }),
    ).toHaveAttribute("aria-current", "true");

    // The mouse's half is the row's own handler, and "the whole row" is meant literally:
    // a click on a memory *inside* the agent-scoped store's framed read-out — most of that
    // row's height, and the distribution a reader most wants to compare — reaches the same
    // place. The overlay never covers this, which is also why the text stays selectable.
    openTab("Agents");
    openAgentRow("Reviewer");
    const scoped = within(
      screen.getByRole("region", { name: "Reviewer memories" }),
    ).getByRole("region", { name: "Reviewer agent-scoped memories" });
    fireEvent.click(within(scoped).getAllByText("review-standards")[0]!);
    expect(screen.getByRole("radio", { name: "Modules" })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "memories overview" }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("reads a store handed to a successor as handed on, not as shared", () => {
    // Two holders and only ever one of them at a time. Every surface but the Agents tab
    // used to read the raw holder count, so an `exec` — and every state of an FSM run —
    // rendered as the agent-scoped sharing the feature exists to find, three lines above
    // the window file's own sentence saying a window is never shared.
    renderMonitor(moduleRun());

    // In the Instances tree: annotated as the hand-off it is, with no link glyph and no
    // holder count to be read as sharing.
    openTab("Instances");
    openFolder("root modules");
    const row = screen.getByRole("button", { name: "root modules tasks" });
    expect(within(row).getByText("handed on")).toBeInTheDocument();
    expect(within(row).queryByText(/holders/)).toBeNull();

    // And in the file itself, which says so in both registers.
    openFile("root modules tasks");
    const file = screen.getByRole("region", { name: "Module" });
    expect(within(file).getByText("handed on")).toBeInTheDocument();
    expect(
      within(file).getByText("held one instance at a time, through 2 holders", {
        exact: false,
      }),
    ).toBeInTheDocument();

    // The Modules tab agrees with it — one concurrent holder, and "handed on" where a
    // shared store names the profile sharing it.
    openTab("Modules");
    // Every group but history is open by default.
    const store = screen.getByRole("button", { name: "module tasks-0" });
    expect(within(store).getByText("1 holder")).toBeInTheDocument();
    expect(within(store).getByText("handed on")).toBeInTheDocument();
    // Its kind Overview counts it as a hand-off rather than as one of the shared stores.
    fireEvent.click(screen.getByRole("button", { name: "tasks overview" }));
    expect(screen.getByText("none shared · 1 handed on")).toBeInTheDocument();
  });

  it("never reports a conversation window as a store nobody wrote to", () => {
    // A window has no snapshot by construction — it reports itself per turn as a context
    // breakdown — and reading that absence as "never written to" inverted the one figure
    // the tab exists to produce, about the fullest thing any agent holds, in every run.
    renderMonitor(moduleRun());

    openTab("Modules");
    openFolder("history modules");
    fireEvent.click(screen.getByRole("button", { name: "history overview" }));
    // No "holding nothing" stat at all — an honest absence rather than a false zero.
    expect(screen.queryByText("holding nothing")).toBeNull();
    expect(screen.queryByText("never written to")).toBeNull();

    // Nor on the Agents tab, where a profile's windows are one store per instance.
    openTab("Agents");
    openAgentRow("Reviewer");
    const history = screen.getByRole("region", { name: "Reviewer history" });
    // The usage line reads as a plain count of stores rather than as a verdict on how many
    // of them went untouched (the facts line above it carries the same count).
    expect(within(history).getAllByText(/^2 stores/).length).toBeGreaterThan(0);
    expect(within(history).queryByText(/never written to/)).toBeNull();
  });

  it("offers no way into a Modules tab the run does not have", () => {
    // Every instance of every run holds a window, and the window has no capability behind
    // it — so a `modules/history` file exists in runs the Modules tab is (rightly) not
    // offered for. An unconditional "Open in Modules" switched to a tab the selector
    // immediately fell back out of, landing the reader on the Dashboard with their place in
    // the tree lost.
    renderMonitor([
      sessionStarted(["shell", "filesystem"]),
      gg({ type: "assistant_message", text: "Working." }),
    ]);
    expect(screen.queryByRole("radio", { name: "Modules" })).toBeNull();

    openTab("Instances");
    openFolder("root modules");
    openFile("root modules history");
    expect(
      screen.queryByRole("button", { name: "Open in Modules" }),
    ).toBeNull();
    // The file itself is unharmed — it is only the dead exit that is withheld.
    expect(screen.getByRole("group", { name: "Window" })).toBeInTheDocument();

    openTab("Agents");
    openAgentRow("Root");
    // Same withholding on the Agents tab, where the exit is the module row itself. Matched
    // by the destination the overlay is named for rather than by one kind's wording, so a
    // row of any kind that grew an overlay here would fail this; and the row must also be
    // left without the `data-clickable` that turns on the hover and cursor affordances,
    // since a row that looks clickable and is not is the same dead exit one step earlier.
    // Both halves of the target go together — no overlay for the keyboard, no handler for
    // the mouse — so clicking the row's body is inert too.
    const history = screen.getByRole("region", { name: "Root history" });
    expect(
      within(history).queryByRole("button", {
        name: /across instances in Modules/,
      }),
    ).toBeNull();
    expect(history).not.toHaveAttribute("data-clickable");
    fireEvent.click(history);
    expect(screen.queryByRole("radio", { name: "Modules" })).toBeNull();
  });

  it("says a pre-identity run's store id is inferred rather than passing it off as a name", () => {
    // A record written before module identity names no stores, so the console synthesizes
    // one private instance per (agent, capability) with a `legacy:` id. Rendering that as
    // the store's identity with nothing saying why sends a reader looking for it in a
    // record that has never heard of it.
    renderMonitor([
      sessionStartedWith([
        { name: "Root", capabilities: ["shell", "memories"] },
      ]),
      gg({ type: "assistant_message", text: "Working." }),
    ]);
    openTab("Instances");
    openFolder("root modules");
    openFile("root modules memories");

    expect(screen.getByText("legacy:root:memories")).toBeInTheDocument();
    expect(screen.getByText("inferred")).toBeInTheDocument();
    expect(
      screen.getByText(/This run predates module identity/),
    ).toBeInTheDocument();
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
        moduleId: "board-0",
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
        moduleId: "board-0",
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

  // A run whose root is a **process**: the machine walks explore → build, the build
  // state forks a copy of itself, and the fork execs into a different profile. gg mints
  // a fresh agent id for every one of those (a successor needs its own self-contained
  // message pool) and parents each to the instance it came from — so without the
  // succession telemetry the tree reads as one agent that spawned four subagents and
  // stopped, which is the wrong story about every part of it.
  it("reads a machine, an exec and a fork as lineage rather than as delegation", () => {
    const events: HarnessEvent[] = [
      sessionStartedWith([
        { name: "Feature", capabilities: ["fsm"] },
        { name: "Explorer", capabilities: ["memories"] },
        { name: "Builder", capabilities: ["tasks", "memories"] },
        { name: "Verifier", capabilities: ["tasks"] },
      ]),
      // The machine enters its first state on the root instance.
      gg({
        type: "fsm_state",
        fsm: "Feature",
        state: "explore",
        agent: "Explorer",
      }),
      // …then transitions, carrying the conversation and the task list and dropping
      // the board. The handoff lands on the OUTGOING stream, the state on the incoming.
      gg({
        type: "agent_transition",
        kind: "fsm",
        toAgentId: "agent-1",
        agent: "Builder",
        state: "build",
        modules: [
          carried("history", "history-0"),
          fresh("memories", "memories-1"),
          carried("tasks", "tasks-0"),
          gone("board", "board-0"),
        ],
      }),
      ggFrom("agent-1", "root", {
        type: "agent_spawned",
        slot: "Builder",
        modelId: "claude-sonnet-4-8",
        depth: 0,
      }),
      ggFrom("agent-1", "root", {
        type: "fsm_state",
        fsm: "Feature",
        state: "build",
        agent: "Builder",
        from: "explore",
      }),
      // The build state runs a copy of itself beside it — a fork is a child, not a
      // succession, so it keeps its place in the subagents folder.
      ggFrom("agent-1", "root", {
        type: "agent_transition",
        kind: "fork",
        toAgentId: "agent-2",
        agent: "Builder",
        modules: [
          copied("history", "history-0", "history-1"),
          copied("memories", "memories-1", "memories-2"),
          copied("tasks", "tasks-0", "tasks-1"),
        ],
      }),
      ggFrom("agent-2", "agent-1", {
        type: "agent_spawned",
        slot: "Builder",
        modelId: "claude-sonnet-4-8",
        depth: 1,
        brief: "Take the renderer while I do the input.",
      }),
      // …and the copy then becomes a different profile outright.
      ggFrom("agent-2", "agent-1", {
        type: "agent_transition",
        kind: "exec",
        toAgentId: "agent-3",
        agent: "Verifier",
        modules: [
          carried("history", "history-1"),
          gone("memories", "memories-2"),
          fresh("tasks", "tasks-2"),
        ],
      }),
      ggFrom("agent-3", "agent-2", {
        type: "agent_spawned",
        slot: "Verifier",
        modelId: "claude-haiku-4-8",
        depth: 1,
      }),
    ];
    renderMonitor(events);
    openTab("Instances");

    // The root's Overview carries the machine's path: the states walked, the profile
    // each runs, and what each transition carried into it.
    expect(screen.getByText("Process · Feature")).toBeInTheDocument();
    expect(screen.getByText("explore")).toBeInTheDocument();
    expect(screen.getAllByText("build").length).toBeGreaterThan(0);
    expect(screen.getByText("+history +tasks")).toBeInTheDocument();

    // The tree marks how each instance arrived. The successor of a transition hangs
    // off the root directly — it is the same agent continuing — rather than inside a
    // `subagents` folder it is not one of.
    expect(screen.getByText("⇢ build")).toBeInTheDocument();
    expect(screen.queryByText("subagents")).toBeNull();

    // Opening it shows the fork, which IS a spawned agent and so keeps its place in
    // the subagents folder.
    openFolder("agent agent-1");
    expect(screen.getByText("subagents")).toBeInTheDocument();
    expect(screen.getByText("⑂ fork")).toBeInTheDocument();

    // The successor's own Overview says where it came from and what came with it,
    // which is the difference between continuing this work and starting fresh.
    openFile("agent-1 overview");
    expect(screen.getByText("transitioned from")).toBeInTheDocument();
    expect(
      screen.getByText(
        "carried history, tasks · dropped board · fresh memories",
      ),
    ).toBeInTheDocument();

    // The exec'd instance reads the same way, under the profile it became — and it
    // hangs off the fork that exec'd, at the same depth, rather than under a second
    // `subagents` folder.
    openFolder("agent agent-2");
    openFolder("agent agent-3");
    openFile("agent-3 overview");
    expect(screen.getByText("continued from")).toBeInTheDocument();
    expect(screen.getAllByText("Verifier").length).toBeGreaterThan(0);

    // And the run's activity feed carries both halves of a succession, each on the
    // stream it actually landed on.
    openFile("root activity");
    expect(
      screen.getByText(/Transitioned to `build` \(Builder\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Entered `explore`, running Explorer/),
    ).toBeInTheDocument();
  });

  it("offers the Replay step-through on a finished run whatever its capabilities", () => {
    // Capture is unconditional (see gg/replay), so the link is not gated on the
    // `replay` capability — which `ALL_CAPABILITIES` deliberately does not include.
    // The gate it replaces read the root agent's set alone, so it was wrong even on
    // its own terms: enabling replay on a subagent silently did nothing.
    renderMonitor(EVENTS, completingWorkersValue);
    const link = screen.getByRole("link", {
      name: /step through what each agent saw and did/i,
    });
    expect(link).toHaveAttribute("href", "/runs/gg/run-1/replay");
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
