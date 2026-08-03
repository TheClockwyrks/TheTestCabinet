/**
 * The map from gg's tool names to this SDK's functions — pure data, with no membrane imports.
 *
 * Three consumers read it, which is why it is data rather than a `switch` somewhere:
 *
 * 1. **The shim**, to bind a scope. Only the entries whose gg tool name is enabled for the run
 *    become names in the evaluated program, so a withheld tool is an undefined identifier rather
 *    than a call that travels to the host to be refused.
 * 2. **`boundTools()`**, the component's second export, which gg calls in a unit test to prove the
 *    *committed artifact* still covers every tool gg offers. That is the one drift check that
 *    catches a stale `.wasm` rather than a stale source file.
 * 3. **`tools/signatures.mjs`**, which reflects each entry's declaration and JSDoc out of the
 *    emitted `.d.ts` into `crates/gg/src/sandbox/signatures.json` — the catalogue gg renders the
 *    system prompt from.
 *
 * It holds one entry per name in `ALL_TOOL_NAMES` (`crates/gg/src/tools/mod.rs`) — there is no
 * class of gg tool a program is denied — and gg asserts exactly that:
 * `boundTools() == ALL_TOOL_NAMES`.
 *
 * The order is `ALL_TOOL_NAMES`' order, so the prompt lists tools in the same sequence gg documents
 * them everywhere else.
 *
 * The model-facing functions that **end a session** ({@link SESSION_ENTRIES}), the ones that put
 * material into the agent's own **context window** ({@link VIEW_ENTRIES}) and the ones that reach
 * back into the **program library** ({@link PROGRAM_ENTRIES}) are deliberately in none of these
 * arrays. None of them is a gg tool, and cataloguing them as ones would break the very bijection
 * consumer 2 exists to check.
 */

/** One tool: gg's name for it, this SDK's function name, and the module that exports it. */
export interface CatalogueEntry {
  /** The gg tool name, as it appears in `ALL_TOOL_NAMES` and in a run's enabled-tool set. */
  tool: string;
  /** The exported function name a program calls. */
  js: string;
  /** The `src/tools/` module that exports it, without the extension. */
  module: string;
}

/**
 * The **API object** each module's functions are grouped under in a program's scope.
 *
 * A program does not receive flat identifiers (`readFile`, `createIssue`, …). It receives a small
 * set of namespaced objects — `fs.readFile`, `project.createIssue` — one per module that offers at
 * least one enabled function, so the surface a model has to reason about is a handful of objects
 * rather than thirty loose names. The shim ({@link "./shim.js"}) builds those objects from this map;
 * a module absent here would have its functions dropped, so every module in {@link TOOL_CATALOGUE}
 * (plus `session`, which carries `finish`) must appear.
 *
 * The names are model-facing product surface, chosen for what a model already expects the object to
 * mean: `fs` for the workspace filesystem, `system` for running commands, `project` for the
 * epic/issue board, `agents` for delegation, `harness` for the calls that are about the session
 * itself rather than the workspace (today just `finish`).
 *
 * The two role-shaped ending objects — `review` and `judge` — are named on {@link SESSION_ENTRIES}
 * instead, because they are grouped by *role* rather than by module: all three groups are exported
 * by the one `session` module.
 *
 * `views` maps to the singular `view` for the same reason `files` maps to `fs`: the object name is
 * read at a call site, and `view.openText(...)` states an intent about one thing where
 * `views.openText(...)` would read like a collection being mutated. `programs` keeps its plural for
 * the mirror reason: it *is* a collection, and `programs.get(12)` reads as reaching into one.
 */
export const OBJECT_FOR_MODULE: Readonly<Record<string, string>> = {
  shell: "system",
  files: "fs",
  skills: "skills",
  memories: "memory",
  tasks: "tasks",
  board: "project",
  context: "context",
  delegation: "agents",
  session: "harness",
  views: "view",
  programs: "programs",
};

/**
 * A helper bound alongside a tool: not a tool itself, so it can never perturb the
 * `ALL_TOOL_NAMES` bijection, but bound into scope and catalogued for the prompt whenever the tool
 * it is built on is enabled.
 */
export interface HelperEntry {
  /** The exported function name a program calls. */
  js: string;
  /** The gg tool it is built on; the helper is bound only when that tool is enabled. */
  requires: string;
}

/** Every gg tool a program can call, in `ALL_TOOL_NAMES` order. */
export const TOOL_CATALOGUE: readonly CatalogueEntry[] = [
  { tool: "shell", js: "shell", module: "shell" },
  { tool: "read_file", js: "readFile", module: "files" },
  { tool: "write_file", js: "writeFile", module: "files" },
  { tool: "edit_file", js: "editFile", module: "files" },
  { tool: "list_dir", js: "listDir", module: "files" },
  { tool: "read_skill", js: "readSkill", module: "skills" },
  { tool: "write_memory", js: "writeMemory", module: "memories" },
  { tool: "update_memory", js: "updateMemory", module: "memories" },
  { tool: "create_memory", js: "createMemory", module: "memories" },
  { tool: "read_memory", js: "readMemory", module: "memories" },
  { tool: "edit_memory", js: "editMemory", module: "memories" },
  { tool: "search_memories", js: "searchMemories", module: "memories" },
  { tool: "delete_memory", js: "deleteMemory", module: "memories" },
  { tool: "add_task", js: "addTask", module: "tasks" },
  { tool: "update_task", js: "updateTask", module: "tasks" },
  { tool: "set_blocked_by", js: "setBlockedBy", module: "tasks" },
  { tool: "complete_task", js: "completeTask", module: "tasks" },
  { tool: "remove_task", js: "removeTask", module: "tasks" },
  { tool: "create_epic", js: "createEpic", module: "board" },
  { tool: "create_issue", js: "createIssue", module: "board" },
  { tool: "update_issue", js: "updateIssue", module: "board" },
  { tool: "set_issue_blocked_by", js: "setIssueBlockedBy", module: "board" },
  { tool: "remove_epic", js: "removeEpic", module: "board" },
  { tool: "remove_issue", js: "removeIssue", module: "board" },
  { tool: "wait_for_issue", js: "waitForIssue", module: "board" },
  { tool: "evict_file_view", js: "evictFileView", module: "context" },
  { tool: "archive_thread", js: "archiveThread", module: "context" },
  { tool: "search_archive", js: "searchArchive", module: "context" },
  { tool: "compact", js: "compact", module: "context" },
  { tool: "spawn_subagent", js: "spawnSubagent", module: "delegation" },
  { tool: "wait_for_subagents", js: "waitForSubagents", module: "delegation" },
  { tool: "send_message", js: "sendMessage", module: "delegation" },
  { tool: "run_workflow", js: "runWorkflow", module: "delegation" },
  { tool: "speculate", js: "speculate", module: "delegation" },
  { tool: "transition_state", js: "transitionState", module: "delegation" },
  { tool: "exec", js: "exec", module: "delegation" },
  { tool: "fork", js: "fork", module: "delegation" },
];

/**
 * Every helper bound alongside a tool.
 *
 * Deliberately one entry. Reading a file's text is the single most common thing a program does, and
 * forcing a variant narrowing on it is friction on the hot path; everything else a "standard
 * library" might add is another name in the prompt and another thing for a model to get wrong.
 */
export const HELPER_CATALOGUE: readonly HelperEntry[] = [
  { js: "readTextFile", requires: "read_file" },
];

/** Which group of ending functions a program is given, mirroring the WIT's `ending-kind`. */
export type EndingKind = "standard" | "review" | "judge";

/** One model-facing ending function: what it is called, where it is grouped, and which role has it. */
export interface SessionEntry {
  /** The exported function name a program calls. */
  js: string;
  /** The API object it is grouped under in a program's scope. */
  object: string;
  /** The role whose programs it is bound for. Exactly one group is bound per program. */
  ending: EndingKind;
}

/**
 * Every model-facing function that ends a session — none of them a gg tool.
 *
 * They are here rather than in {@link TOOL_CATALOGUE} because they have no gg tool names: putting
 * them there would break the bijection `boundTools() == ALL_TOOL_NAMES` that the committed
 * component is checked against.
 *
 * An ending is a **result**, and a role's result has a shape: work reports what was done, a review
 * returns a verdict, a judgement names a winner. So there is one function per shape, each carrying
 * exactly what that result is made of, and the shim binds only the group matching the `ending` the
 * host passed to `run`. A reviewer's program has no `finish` in scope at all — not a `finish` the
 * host refuses — which is the same capability model the tools use.
 *
 * Two consumers, the same two the catalogue has: the shim binds these into a program's scope, and
 * `tools/signatures.mjs` reflects each declaration and its JSDoc out of `session`'s emitted `.d.ts`
 * so the prompt can teach a model the ending it is actually held to.
 */
export const SESSION_ENTRIES: readonly SessionEntry[] = [
  { js: "finish", object: "harness", ending: "standard" },
  { js: "approve", object: "review", ending: "review" },
  { js: "requestChanges", object: "review", ending: "review" },
  { js: "selectWinner", object: "judge", ending: "judge" },
];

/** The module every {@link SESSION_ENTRIES} function is exported by. */
export const SESSION_MODULE = "session";

/** One model-facing view function: what it is called, and the gg tool (if any) that gates it. */
export interface ViewEntry {
  /** The exported function name a program calls. */
  js: string;
  /**
   * The gg tool whose being enabled binds it, or `undefined` when nothing gates it.
   *
   * Deliberately the same shape {@link HelperEntry.requires} has, and read the same way by the shim:
   * a gated view function is bound exactly when its tool is, an ungated one always.
   */
  requires?: string;
}

/**
 * Every model-facing view function — the calls that put material into the agent's own context
 * window. None of them is a gg tool.
 *
 * They are here rather than in {@link TOOL_CATALOGUE} for the same reason {@link SESSION_ENTRIES}
 * are: they have no gg tool names, so cataloguing them as tools would break the bijection
 * `boundTools() == ALL_TOOL_NAMES` that the committed component is checked against — and *making*
 * them tools would hand a native tool-calling session an `open_file_view` that duplicates
 * `read_file`, which on that path already arrives as an attributable message.
 *
 * `openText`, `openDocsView`, `close` and `current` are **ungated**, the carve-out `harness` has and
 * for the same reason: a run that enables no tools at all must still be able to show its model
 * something — and must always be able to read what the functions it does have do.
 * `openFile` is a read, so it carries `requires: "read_file"` — a run with reading withheld must not
 * get a read through a side door.
 *
 * The same two consumers the other arrays have: the shim binds these into a program's scope, and
 * `tools/signatures.mjs` reflects each declaration and its JSDoc out of `views`' emitted `.d.ts` so
 * the prompt and `fn.docs()` describe the surface the component really exports.
 */
export const VIEW_ENTRIES: readonly ViewEntry[] = [
  { js: "openFile", requires: "read_file" },
  { js: "openText" },
  { js: "openDocsView" },
  { js: "close" },
  { js: "current" },
];

/** The module every {@link VIEW_ENTRIES} function is exported by. */
export const VIEW_MODULE = "views";

/**
 * Every model-facing function on the **program library** — the object a program reaches back through
 * for the source of a program it already ran. None of them is a gg tool.
 *
 * They are here rather than in {@link TOOL_CATALOGUE} for the reason {@link SESSION_ENTRIES} and
 * {@link VIEW_ENTRIES} are: they have no gg tool names, so cataloguing them as tools would break the
 * `boundTools() == ALL_TOOL_NAMES` bijection the committed component is checked against.
 *
 * They are a plain list of names rather than gated entries because the whole object is bound or
 * absent together, from the `library` flag the host passes to {@link "./shim.js".run}: a *capability*
 * decides this family, and no tool name stands for it.
 */
export const PROGRAM_ENTRIES: readonly string[] = ["history", "get", "rerun"];

/** The module every {@link PROGRAM_ENTRIES} function is exported by. */
export const PROGRAM_MODULE = "programs";

/**
 * The non-enumerable key every bound function carries the name gg knows it by under, so
 * `view.openDocsView(fs.readFile)` can be spelled with the function rather than with a string.
 *
 * A `Symbol` rather than a property name so it is invisible to a model iterating an object, and here
 * rather than in the shim because both the shim (which writes it) and `tools/views.ts` (which reads
 * it) need the identical symbol.
 */
export const DOCS_NAME = Symbol("gg.docsName");
