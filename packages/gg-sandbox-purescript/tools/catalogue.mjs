/**
 * The **identity** half of this arm's catalogue: which function is which, on which object, gated by
 * what.
 *
 * Nothing here is prose a model reads. Every word of that — what a function does, what to put in
 * each argument, what a type's field means — is written on the declaration it describes, in
 * `src/Gg/**`, and reflected out of `purs`' own documentation by `tools/signatures.mjs`. What is
 * here is the part PureScript cannot say: that `fs.readFile` **is** gg's `read_file` tool, that
 * `review.requestChanges` is the same capability Python spells `review.request_changes`, and that
 * `view.openFile` is bound exactly when `read_file` is.
 *
 * That split is what makes the [agreement gate](../../../apps/docs/src/content/docs/gg/program-languages.md)
 * possible: it compares two languages' catalogues by identity — section, object, key, gate, ending —
 * and lets every spelling differ.
 *
 * The other language guests keep the same data in their own SDK, because theirs *uses* it at run
 * time to build a program's scope. This one has no such use for it: a PureScript API object is a
 * record whose fields are fixed when the SDK is compiled, so there is nothing to build per run and
 * nothing that would notice if this file drifted. `tools/signatures.mjs` therefore checks it against
 * the SDK it reflects — a name here that no module declares, or a declaration no entry here names,
 * fails the reflection rather than reaching a model.
 */

/**
 * The API objects a program's surface is divided into, **in the order it is presented in**, each
 * with the module whose declarations it is built from.
 *
 * The order is model-facing: it is the sequence the system prompt's API list renders in and the
 * sequence the run's agent surface reports. It runs from the objects almost every run has (`fs`,
 * `system`) to the ones a particular shape of agent has (`programs`, `harness`, `review`), because a
 * model reads a list from the top.
 *
 * The object's own one-line description is not here: it is the doc comment on the record itself, in
 * that module.
 */
export const OBJECTS = [
  { object: "fs", module: "Gg.Fs" },
  { object: "system", module: "Gg.System" },
  { object: "project", module: "Gg.Project" },
  { object: "tasks", module: "Gg.Tasks" },
  { object: "memory", module: "Gg.Memory" },
  { object: "view", module: "Gg.View" },
  { object: "context", module: "Gg.Context" },
  { object: "agents", module: "Gg.Agents" },
  { object: "skills", module: "Gg.Skills" },
  { object: "programs", module: "Gg.Programs" },
  { object: "harness", module: "Gg.Harness" },
  { object: "review", module: "Gg.Review" },
];

/**
 * Every gg tool a program can call, in `ALL_TOOL_NAMES` order — which is the order gg documents them
 * in everywhere else.
 *
 * A tool carries its own identity: `tool` is its name in gg's vocabulary, and every language's
 * catalogue describes the same set of them under its own spellings.
 */
export const TOOLS = [
  { tool: "shell", object: "system", name: "shell" },
  { tool: "read_file", object: "fs", name: "readFile" },
  { tool: "write_file", object: "fs", name: "writeFile" },
  { tool: "edit_file", object: "fs", name: "editFile" },
  { tool: "list_dir", object: "fs", name: "listDir" },
  { tool: "read_skill", object: "skills", name: "readSkill" },
  { tool: "write_memory", object: "memory", name: "writeMemory" },
  { tool: "update_memory", object: "memory", name: "updateMemory" },
  { tool: "create_memory", object: "memory", name: "createMemory" },
  { tool: "read_memory", object: "memory", name: "readMemory" },
  { tool: "edit_memory", object: "memory", name: "editMemory" },
  { tool: "search_memories", object: "memory", name: "searchMemories" },
  { tool: "delete_memory", object: "memory", name: "deleteMemory" },
  { tool: "add_task", object: "tasks", name: "addTask" },
  { tool: "update_task", object: "tasks", name: "updateTask" },
  { tool: "set_blocked_by", object: "tasks", name: "setBlockedBy" },
  { tool: "complete_task", object: "tasks", name: "completeTask" },
  { tool: "remove_task", object: "tasks", name: "removeTask" },
  { tool: "create_epic", object: "project", name: "createEpic" },
  { tool: "create_issue", object: "project", name: "createIssue" },
  { tool: "update_issue", object: "project", name: "updateIssue" },
  { tool: "set_issue_blocked_by", object: "project", name: "setIssueBlockedBy" },
  { tool: "remove_epic", object: "project", name: "removeEpic" },
  { tool: "remove_issue", object: "project", name: "removeIssue" },
  { tool: "wait_for_issue", object: "project", name: "waitForIssue" },
  { tool: "evict_file_view", object: "context", name: "evictFileView" },
  { tool: "archive_thread", object: "context", name: "archiveThread" },
  { tool: "search_archive", object: "context", name: "searchArchive" },
  { tool: "compact", object: "context", name: "compact" },
  { tool: "spawn_subagent", object: "agents", name: "spawnSubagent" },
  { tool: "wait_for_subagents", object: "agents", name: "waitForSubagents" },
  { tool: "send_message", object: "agents", name: "sendMessage" },
  { tool: "transition_state", object: "agents", name: "transitionState" },
  { tool: "exec", object: "agents", name: "exec" },
  { tool: "fork", object: "agents", name: "fork" },
];

/**
 * Every helper bound alongside a tool: not a tool itself, so it can never perturb the bijection
 * between the guest's bound names and gg's tool vocabulary, but bound into a program's scope and
 * catalogued whenever the tool it is built on is enabled.
 */
export const HELPERS = [
  { key: "read_text_file", requires: "read_file", object: "fs", name: "readTextFile" },
];

/**
 * Every model-facing function that **ends a session**, one group per role. None of them is a gg
 * tool; each carries a `key` instead, which is the identity another language's SDK spells its own
 * way.
 */
export const SESSION = [
  { key: "finish", object: "harness", name: "finish", ending: "standard" },
  { key: "approve", object: "review", name: "approve", ending: "review" },
  { key: "request_changes", object: "review", name: "requestChanges", ending: "review" },
];

/**
 * Every model-facing **view** function — the calls that put material into the agent's own context
 * window.
 *
 * `openFile` is a read, so it is bound exactly when `read_file` is; the other four are ungated, the
 * same carve-out `harness` has and for the same reason: a run that enables no tools at all must
 * still be able to show its model something, and must always be able to read what the functions it
 * does have do.
 */
export const VIEWS = [
  { key: "open_file", requires: "read_file", object: "view", name: "openFile" },
  { key: "open_text", object: "view", name: "openText" },
  { key: "open_docs_view", object: "view", name: "openDocsView" },
  { key: "close", object: "view", name: "close" },
  { key: "current", object: "view", name: "current" },
];

/**
 * Every model-facing function on the **program library**. They carry no gate at all: the whole
 * object is bound or absent together, from a capability rather than from a tool or a role.
 */
export const PROGRAMS = [
  { key: "history", object: "programs", name: "history" },
  { key: "get", object: "programs", name: "get" },
  { key: "rerun", object: "programs", name: "rerun" },
];

/**
 * Every model-facing function that belongs to **no** API object, because it belongs to all of them.
 *
 * `list` is the whole of it: every object this SDK offers carries one, bound with that object's own
 * name closed over, so the function a program calls takes no arguments and there is no one object it
 * hangs off.
 */
export const META = [{ key: "list", module: "Gg.Meta", name: "list" }];

/** The modules whose declarations are the catalogue's `types` section. */
export const TYPE_MODULES = ["Gg.Error", "Gg.Types"];

/** The module each object's functions are declared in. */
export function moduleFor(object) {
  const entry = OBJECTS.find((candidate) => candidate.object === object);
  if (entry === undefined) throw new Error(`no module is declared for the \`${object}\` object`);
  return entry.module;
}
