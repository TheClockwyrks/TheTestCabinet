// What one agent instance's folder holds in the Instances explorer, and how one of
// those things is named, gated and selected.
//
// An agent folder holds two different kinds of thing, and keeps them apart:
// facts about the *agent* (what it was told, what it did, how full its window got, what
// it spent) and views onto the *state it holds* (its task list, its memories). The two
// were indistinguishable while a module belonged to exactly one agent — but a module
// instance can now be held by several agents at once, carried whole to a successor, or
// copied when its holder forks (see gg/modules), so "this agent's tasks" is no longer a
// property of the agent at all. It is a store the agent happens to be a holder of.
//
// So the folder has two sections: the agent's own files, and a `modules` folder holding
// one entry per module instance it holds. An {@link AgentEntry} is whichever of those
// two is selected. Two arms rather than one widened enum, so both the sidebar's and the
// content pane's `switch`es stay exhaustive: a module kind added to the contract then
// becomes a compile error here, which is exactly where it should surface.

import type { ComponentType } from "react";
import type {
  GgCapabilitySet,
  GgModuleKind,
} from "@test-cabinet/run-record/gg";
import { agentCapabilityOn } from "./ggCatalog";
import type { GgModuleInstance } from "./ggModules";
import type { GgAgentSurface } from "./useGgRunState";
import {
  ActivityIcon,
  ApiIcon,
  ArchiveIcon,
  BoardIcon,
  CompactionIcon,
  ContextIcon,
  HistoryIcon,
  KnowledgeIcon,
  MemoriesIcon,
  MetricsIcon,
  OverviewIcon,
  PromptIcon,
  RequestsIcon,
  TasksIcon,
  ToolsIcon,
} from "./ggIcons";

// The "files" an agent folder can contain — the things a gg run lets you monitor about
// one agent *itself*.
//
// Everything here is a fact about the instance rather than about anything it holds:
// what it is (overview), what it was told (prompt), what it was *offered* to call
// (surface), what it did (activity), how its window filled and what filled it (context,
// requests, metrics) and what happened when that window was summarized (compaction). The
// views onto module state live in the `modules` folder, one entry per module
// instance (see {@link AgentEntry}).
//
// `compaction` deliberately stays here despite looking module-shaped: it is gated on the
// compaction capability, which is **not** module-backed — there is no
// `GgModuleKind::Compaction` — so filing it under modules would invent a module that
// does not exist.
export type AgentFileKind =
  | "overview"
  | "prompt"
  | "surface"
  | "activity"
  | "context"
  | "requests"
  | "metrics"
  | "compaction";

// One selectable thing inside an agent's folder: one of its own files, or one of the
// module instances it holds.
export type AgentEntry =
  | { kind: "file"; file: AgentFileKind }
  | { kind: "module"; module: GgModuleKind };

// The entry every agent folder can always offer, and the explorer's landing.
export const OVERVIEW_ENTRY: AgentEntry = { kind: "file", file: "overview" };

// Whether two entries select the same thing — the comparison the selection-validity
// effect and every row's `aria-current` are written in.
export function sameEntry(a: AgentEntry, b: AgentEntry): boolean {
  return a.kind === "file"
    ? b.kind === "file" && a.file === b.file
    : b.kind === "module" && a.module === b.module;
}

// The order files list in a folder. Prompt sits right after Overview — reading an
// agent starts with what it *is* and then what it was *told* (for a subagent, the
// brief its parent handed it) — and the offered surface follows it, because what an
// agent could *call* is the other half of what it was given, and it has to be read
// before its activity for that activity to mean anything. Requests sits beside Context
// — it is the itemized, message-level companion to the stacked Context graph — then
// Metrics, the per-request over-time graphs (throughput, cost, cache-read and reasoning
// share) that are the value-per-call companion to that same graph; Compaction follows,
// the detail behind the Context graph's compaction markers.
const FILE_ORDER: ReadonlyArray<AgentFileKind> = [
  "overview",
  "prompt",
  "surface",
  "activity",
  "context",
  "requests",
  "metrics",
  "compaction",
];

// Which capabilities a file needs before it is worth offering — a file is shown when
// *any* of its capabilities is on. An empty list is unconditional: overview and activity
// read gg's own account of any run, and Context is always offered because every run has a
// window that fills. This mirrors the run's [capability set], so the folder shows a file
// for a capability the run *has* even before that capability has produced anything — the
// file then shows its own "nothing yet" state rather than being absent — and hides a file
// only for a capability the run does not have at all.
const FILE_CAPABILITIES: Record<AgentFileKind, ReadonlyArray<string>> = {
  overview: [],
  // Unconditional: a subagent's brief rides on the (always-present) spawn event, and
  // the root's opening prompt is a first-class thing to read — the same "offered, may be
  // empty" contract as overview and activity.
  prompt: [],
  // Not capability-shaped, and the empty list here is not "unconditional": the surface
  // file is the one file gated on the INSTANCE rather than on the configuration — it is
  // offered exactly when that instance reported what it was offered (see {@link
  // filesFor}). It has to be, because an instance read before its `agent_surface` has
  // arrived reports none at all, and a file that showed an empty toolset for it would
  // assert the very thing it exists to distinguish: nothing offered.
  surface: [],
  activity: [],
  context: [],
  // The message log and the breakdown graph are context visibility, which is intrinsic —
  // every run emits both — so the file is always offered.
  requests: [],
  // The per-request metric graphs ride on the same intrinsic `prompt` stream the
  // Requests file does — every run makes model calls carrying tokens/cost — so the
  // file is always offered (its own graphs show an empty state until a metric has data).
  metrics: [],
  // The Compaction file rides on the compaction capability itself: with the backstop
  // off, a run never compacts, so the file is hidden rather than shown perpetually
  // empty. Its own record travels on the compaction event, so it needs nothing else.
  compaction: ["compaction"],
};

// What each file is called in the tree. Every kind but one is named the same way in
// every folder; the surface file is named for how its instance answers a turn, so these
// hold its tool-calling name and {@link fileLabel} is what reads them.
const FILE_LABELS: Record<AgentFileKind, string> = {
  overview: "overview",
  prompt: "prompt",
  surface: "tools",
  activity: "activity",
  context: "context",
  requests: "requests",
  metrics: "metrics",
  compaction: "compaction",
};

// A leading icon per file kind, drawn from the shared line-art set (see ggIcons)
// so the tree scans like a real file browser rather than by ad-hoc glyphs.
const FILE_ICONS: Record<
  AgentFileKind,
  ComponentType<{ className?: string }>
> = {
  overview: OverviewIcon,
  prompt: PromptIcon,
  surface: ToolsIcon,
  activity: ActivityIcon,
  context: ContextIcon,
  requests: RequestsIcon,
  metrics: MetricsIcon,
  compaction: CompactionIcon,
};

// Whether an instance answers its turns by writing *code* rather than by naming a tool —
// the one bit of a surface that decides how its file is named, marked and read. Anything
// else, an unrecognised mode from a newer gg included, reads as tool calling: `tools` is
// what such a file lists, and reading a mode nothing here understands as the surface with
// the flat list is the honest fallback rather than a guess at a third shape.
//
// Exported so the file's content and the row that opens it decide by one predicate:
// a folder offering `apis` over a list of bare tool names would be the label lying about
// what it opens.
export function answersAsCode(surface: GgAgentSurface | undefined): boolean {
  return surface?.executionMode === "responses_as_code";
}

// How one file is named in an instance's folder. Constant for every kind but the
// surface, which is called `tools` for an agent that answers in tool calls and `apis`
// for one that answers in code — two independent surfaces, one per agent, and one name
// for both would misname whichever agent it was not written for.
//
// A resolver rather than a second table because the name depends on the *instance*,
// which no per-kind table can see; the tables stay the source of truth for everything
// that does not.
export function fileLabel(
  file: AgentFileKind,
  surface?: GgAgentSurface,
): string {
  return file === "surface" && answersAsCode(surface)
    ? "apis"
    : FILE_LABELS[file];
}

// The mark one file carries, resolved the same way and for the same reason as its
// name: the wrench and the angle brackets are the two shapes the same question takes,
// and the glyph is what says which of them this instance is being asked.
export function fileIcon(
  file: AgentFileKind,
  surface?: GgAgentSurface,
): ComponentType<{ className?: string }> {
  return file === "surface" && answersAsCode(surface)
    ? ApiIcon
    : FILE_ICONS[file];
}

// The mark each module kind carries in the tree and on its own file's header. Skills
// keep the open-book glyph the joint Knowledge file used; memories, which shared it,
// get their own — the two are separate modules, gated separately and shared on entirely
// different terms, and one glyph for both was the visual half of that conflation.
export const MODULE_ICONS: Record<
  GgModuleKind,
  ComponentType<{ className?: string }>
> = {
  history: HistoryIcon,
  memories: MemoriesIcon,
  tasks: TasksIcon,
  board: BoardIcon,
  skills: KnowledgeIcon,
  archive: ArchiveIcon,
};

// Which files ONE agent's folder offers, given the run's configuration and the id of the
// profile that agent runs under. A file is offered when that agent's *own*
// capabilities justify it — so a file for a capability it has is always present
// (showing its own empty state until data arrives) and a file for a capability it
// does not have is never shown. Before gg announces the set (set == null), only the
// unconditional files are offered.
//
// Per-agent rather than per-run because gg's capabilities are per-agent: a run
// routinely gives an issue's implementer a task list its Root has no use for, and
// reading the Root's configuration for every folder in the tree hides exactly the
// file the agent that has the capability should be showing.
//
// The surface file is the exception, and takes the instance's own reported surface: it
// is offered when that incarnation said what it was offered, and withheld — completely,
// not as an empty list — until it has.
export function filesFor(
  set: GgCapabilitySet | null,
  agentId: string | null | undefined,
  surface?: GgAgentSurface,
): AgentFileKind[] {
  return FILE_ORDER.filter((file) => {
    if (file === "surface") return surface != null;
    const needed = FILE_CAPABILITIES[file];
    if (needed.length === 0) return true;
    if (!set) return false;
    return needed.some((id) => agentCapabilityOn(set, agentId, id));
  });
}

// Everything one agent instance's folder offers: its own files, then the module
// instances it holds, in the contract's kind order.
//
// The module half is not gated here. `ggModules` has already decided what this instance
// holds — from its reported roster where the run had one, and from its profile's
// capabilities where it did not — and re-deriving that from the capability set would be a
// second, divergent answer to a question that has one.
export function entriesFor(
  set: GgCapabilitySet | null,
  agentId: string | null | undefined,
  modules: readonly GgModuleInstance[],
  surface?: GgAgentSurface,
): AgentEntry[] {
  return [
    ...filesFor(set, agentId, surface).map(
      (file): AgentEntry => ({ kind: "file", file }),
    ),
    ...modules.map(
      (module): AgentEntry => ({
        kind: "module",
        module: module.kind,
      }),
    ),
  ];
}
