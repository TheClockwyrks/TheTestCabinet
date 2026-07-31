// What one agent instance's folder holds in the Instances explorer, and how one of
// those things is named, gated and selected.
//
// An agent folder used to hold a flat list of "files" — one per thing a run lets you
// monitor about that instance. That list quietly mixed two different kinds of thing:
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
import {
  ActivityIcon,
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
} from "./ggIcons";

// The "files" an agent folder can contain — the things a gg run lets you monitor about
// one agent *itself*.
//
// Everything here is a fact about the instance rather than about anything it holds:
// what it is (overview), what it was told (prompt), what it did (activity), how its
// window filled and what filled it (context, requests, metrics) and what happened when
// that window was summarized (compaction). The views that used to sit beside these —
// `tasks` and a joint `knowledge` file — were views onto module state, so they live in
// the `modules` folder now, one entry per module instance (see {@link AgentEntry}).
//
// `compaction` deliberately stays here despite looking module-shaped: it is gated on the
// compaction capability, which is **not** module-backed — there is no
// `GgModuleKind::Compaction` — so filing it under modules would invent a module that
// does not exist.
export type AgentFileKind =
  | "overview"
  | "prompt"
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
// brief its parent handed it). Requests sits beside Context — it is the itemized,
// message-level companion to the stacked Context graph — then Metrics, the
// per-request over-time graphs (throughput, cost, cache-read and reasoning share)
// that are the value-per-call companion to that same graph; Compaction follows, the
// detail behind the Context graph's compaction markers.
const FILE_ORDER: ReadonlyArray<AgentFileKind> = [
  "overview",
  "prompt",
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
  // the root's opening prompt is a first-class thing to read. An older run that recorded
  // no rendered prompt shows the brief or says so rather than being absent — the same
  // "offered, may be empty" contract as overview and activity.
  prompt: [],
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

export const FILE_LABELS: Record<AgentFileKind, string> = {
  overview: "overview",
  prompt: "prompt",
  activity: "activity",
  context: "context",
  requests: "requests",
  metrics: "metrics",
  compaction: "compaction",
};

// A leading icon per file kind, drawn from the shared line-art set (see ggIcons)
// so the tree scans like a real file browser rather than by ad-hoc glyphs.
export const FILE_ICONS: Record<
  AgentFileKind,
  ComponentType<{ className?: string }>
> = {
  overview: OverviewIcon,
  prompt: PromptIcon,
  activity: ActivityIcon,
  context: ContextIcon,
  requests: RequestsIcon,
  metrics: MetricsIcon,
  compaction: CompactionIcon,
};

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

// Which files ONE agent's folder offers, given the run's configuration and which
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
export function filesFor(
  set: GgCapabilitySet | null,
  agent: string | null | undefined,
): AgentFileKind[] {
  return FILE_ORDER.filter((file) => {
    const needed = FILE_CAPABILITIES[file];
    if (needed.length === 0) return true;
    if (!set) return false;
    return needed.some((id) => agentCapabilityOn(set, agent, id));
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
  agent: string | null | undefined,
  modules: readonly GgModuleInstance[],
): AgentEntry[] {
  return [
    ...filesFor(set, agent).map((file): AgentEntry => ({ kind: "file", file })),
    ...modules.map(
      (module): AgentEntry => ({
        kind: "module",
        module: module.kind,
      }),
    ),
  ];
}
