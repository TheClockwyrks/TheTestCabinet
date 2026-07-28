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
 * It holds **31** entries, not the 34 names in `ALL_TOOL_NAMES` (`crates/gg/src/tools/mod.rs`).
 * `enter_plan_mode`, `submit_plan` and `advance_state` are absent by design: they change the loop's
 * *mode*, which is not a value a program can compose, so they are declared in the WIT, refused by
 * the host as a backstop, and never bound into a program's scope. gg asserts
 * `boundTools() == ALL_TOOL_NAMES \ TURN_LEVEL_TOOLS`.
 *
 * The order is `ALL_TOOL_NAMES`' order, so the prompt lists tools in the same sequence gg documents
 * them everywhere else.
 *
 * One model-facing function is deliberately **not** in either array — {@link SESSION_ENTRY}, the call
 * that ends the run. It is not a gg tool, and cataloguing it as one would break the very bijection
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
 * epic/issue board, `agents` for delegation, `harness` for the two calls that are about the run
 * itself rather than the workspace (`finish`, and the documentation lookup).
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
  { tool: "complete_issue", js: "completeIssue", module: "board" },
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

/**
 * The one model-facing function that is not a gg tool: the call that ends the run.
 *
 * A constant rather than an array because there is exactly one, and rather than a `TOOL_CATALOGUE`
 * entry because it has no gg tool name — putting it there would break the bijection
 * `boundTools() == ALL_TOOL_NAMES \ TURN_LEVEL_TOOLS` that the committed component is checked
 * against.
 *
 * Its two consumers are the same two the catalogue has: the shim binds `js` into **every** program's
 * scope, unconditionally and ungated by any capability, and `tools/signatures.mjs` reflects the
 * declaration and JSDoc out of `module`'s emitted `.d.ts` so the system prompt can teach a model how
 * to end its run.
 */
export const SESSION_ENTRY: { js: string; module: string } = { js: "finish", module: "session" };
