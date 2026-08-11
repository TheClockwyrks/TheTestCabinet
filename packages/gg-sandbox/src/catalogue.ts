/**
 * What this guest needs in order to build a program's surface — and nothing a model ever reads.
 *
 * It is deliberately much smaller than it was, and it lost its whole reason for existing in the
 * process. Every fact about what a function is *called*, what it *does*, which module it lives in
 * and which gg operation it binds is written on the declaration itself — the module it is declared
 * in, its export, its JSDoc, its `@ggop`. And the one thing a declaration could not state — **what
 * buys a call at run time** — is no longer this guest's business at all.
 *
 * gg owns that, and gg enforces it. Its operations table says whether an operation is bought by a gg
 * tool, by a capability, by a role's ending, or by nothing, and the **membrane** checks it when the
 * call arrives. This guest binds every function it has into every program's scope, unconditionally:
 * the SDK is static, a withheld call is a call that reaches the host and is refused there with a
 * sentence naming what is missing, and there is no reading of a run's enabled set anywhere in this
 * package any more.
 *
 * What is left here is the module vocabulary a scope is assembled from, the alias names two sibling
 * arms resolve against this same scope, and the one table that is a claim about *this package*
 * rather than about a run: which gg tool each operation this SDK implements would dispatch, read by
 * `boundTools` and by nothing else.
 */

/** The gg module ids this SDK is divided into, in the order the surface is presented in. */
export type ModuleId =
  | "files"
  | "shell"
  | "board"
  | "tasks"
  | "memories"
  | "views"
  | "context"
  | "delegation"
  | "skills"
  | "programs"
  | "session"
  | "core";

/**
 * Every capability module, in the order a program's surface is presented in.
 *
 * The ids are gg's own module vocabulary — the same namespaces its operation ids are built on — so
 * this tuple is the join between `gg.files` the TypeScript module and `files.read_file` the gg
 * operation. The order is model-facing: it is the sequence the system prompt lists modules in and the
 * sequence the run's agent surface reports, running from the modules almost every run has to the ones
 * a particular shape of agent has.
 *
 * `core` is last and carries no function at all: it holds the types every other module's signatures
 * name, so it is a module for the sake of the names its types are qualified by.
 */
export const MODULE_ORDER: readonly ModuleId[] = [
  "files",
  "shell",
  "board",
  "tasks",
  "memories",
  "views",
  "context",
  "delegation",
  "skills",
  "programs",
  "session",
  "core",
];

/**
 * The object a program reaches every module through, and therefore the stem of every fully-qualified
 * name.
 *
 * `gg.files.readFile` is both the key a documentation view is opened by and a path a program can
 * write, which is the whole reason the modules are real TypeScript modules bound under one namespace
 * rather than a set of objects assembled at run time.
 */
export const SURFACE = "gg";

/**
 * The **API object** names each module's functions are also reachable under, kept for one reader and
 * no second.
 *
 * That reader is the PureScript, Java and Kotlin arms' compiled bundles, which this same component
 * evaluates and which resolve these as free identifiers. Their SDKs are their own — `Gg.Files`,
 * `Gg.Views` — and the names below are the lowering they were written against, so removing one would
 * break an arm this package does not own.
 *
 * `session` has **two**, and that is the whole of what the static scope changed here. An ending group
 * used to be chosen per program from the agent's role, so a reviewer's scope carried `review` and no
 * `harness`; now both are bound, always, and which of them the host will accept is the host's
 * business. A reviewer that calls `harness.finish` therefore gets gg's own sentence — it ends its
 * session with a verdict, and here are the two calls that do — instead of a `ReferenceError` naming
 * an identifier.
 */
export const LEGACY_GROUPINGS: Readonly<
  Partial<Record<ModuleId, readonly string[]>>
> = {
  files: ["fs"],
  shell: ["system"],
  board: ["project"],
  tasks: ["tasks"],
  memories: ["memory"],
  views: ["view"],
  context: ["context"],
  delegation: ["agents"],
  skills: ["skills"],
  programs: ["programs"],
  session: ["harness", "review"],
};

/**
 * Every gg tool, in `ALL_TOOL_NAMES` order.
 *
 * This is gg's tool vocabulary rather than this SDK's, and the guest carries it for exactly one
 * reason: `boundTools` answers the component's second export with it, and gg compares that answer
 * against its own `ALL_TOOL_NAMES` on the **committed artifact**. It is the one drift check that
 * catches a stale `.wasm` rather than a stale source file, so a tool added, renamed or removed in gg
 * fails against the binary that would otherwise silently not implement it.
 */
export const GG_TOOLS: readonly string[] = [
  "shell",
  "read_file",
  "write_file",
  "edit_file",
  "list_dir",
  "read_skill",
  "write_memory",
  "update_memory",
  "create_memory",
  "read_memory",
  "edit_memory",
  "search_memories",
  "delete_memory",
  "add_task",
  "update_task",
  "set_blocked_by",
  "complete_task",
  "remove_task",
  "create_epic",
  "create_issue",
  "update_issue",
  "set_issue_blocked_by",
  "remove_epic",
  "remove_issue",
  "wait_for_issue",
  "evict_file_view",
  "archive_thread",
  "search_archive",
  "compact",
  "spawn_subagent",
  "wait_for_subagents",
  "send_message",
  "transition_state",
  "exec",
  "fork",
];

/**
 * Every operation a gg **tool** buys, and which tool buys it.
 *
 * It no longer decides anything a program can see: the scope is static, so this table is read by
 * {@link "./shim.js".boundTools} alone — the export gg compares against its own tool vocabulary on
 * the committed artifact. What buys a call at *run time* is gg's own operations table, checked at
 * the membrane; what is here is only "which gg tool does this SDK implement a function for", which
 * is a claim about this package rather than about a run.
 *
 * Three of these are not one-to-one, and each says something real. `files.read_text_file` is a helper
 * rather than a tool of its own, so it is bought by the read it is built on; `views.open_file`
 * performs that same read on the way to showing the file, so a run with reading withheld must not get
 * one through a side door. Everything else names the tool that shares its key.
 */
export const TOOL_BOUND: Readonly<Record<string, string>> = {
  "shell.shell": "shell",
  "files.read_file": "read_file",
  "files.read_text_file": "read_file",
  "files.write_file": "write_file",
  "files.edit_file": "edit_file",
  "files.list_dir": "list_dir",
  "skills.read_skill": "read_skill",
  "memories.write_memory": "write_memory",
  "memories.update_memory": "update_memory",
  "memories.create_memory": "create_memory",
  "memories.read_memory": "read_memory",
  "memories.edit_memory": "edit_memory",
  "memories.search_memories": "search_memories",
  "memories.delete_memory": "delete_memory",
  "tasks.add_task": "add_task",
  "tasks.update_task": "update_task",
  "tasks.set_blocked_by": "set_blocked_by",
  "tasks.complete_task": "complete_task",
  "tasks.remove_task": "remove_task",
  "board.create_epic": "create_epic",
  "board.create_issue": "create_issue",
  "board.update_issue": "update_issue",
  "board.set_issue_blocked_by": "set_issue_blocked_by",
  "board.remove_epic": "remove_epic",
  "board.remove_issue": "remove_issue",
  "board.wait_for_issue": "wait_for_issue",
  "context.evict_file_view": "evict_file_view",
  "context.archive_thread": "archive_thread",
  "context.search_archive": "search_archive",
  "context.compact": "compact",
  "delegation.spawn_subagent": "spawn_subagent",
  "delegation.wait_for_subagents": "wait_for_subagents",
  "delegation.send_message": "send_message",
  "delegation.transition_state": "transition_state",
  "delegation.exec": "exec",
  "delegation.fork": "fork",
  "views.open_file": "read_file",
};

/**
 * **Every gg operation this SDK implements**, in catalogue order.
 *
 * It states one thing and gates nothing: that this package declares a function for each of these,
 * and for nothing else. `tools/signatures.mjs` reads it in both directions — a declaration whose
 * `@ggop` names an operation that is not here is refused, and an operation here that no declaration
 * binds is refused — so a function added without an operation, or an operation added without a
 * function, fails the reflector rather than reaching a model as an absence.
 *
 * What buys any of them at run time is gg's business and is written down in gg's own operations
 * table. Nothing here is read on a turn path: {@link buildScope} binds what the modules export, and
 * the membrane decides what happens when one is called.
 */
export const OPERATIONS: readonly string[] = [
  ...Object.keys(TOOL_BOUND),
  "views.open_text",
  "views.open_docs_view",
  "views.close",
  "views.current",
  "programs.history",
  "programs.get",
  "programs.rerun",
  "session.finish",
  "session.approve",
  "session.request_changes",
];

/**
 * Which group of ending functions the host will **accept** from this program, mirroring the WIT's
 * `ending-kind`.
 *
 * It no longer decides what is bound — every ending function is in every program's scope — and the
 * guest does nothing with it at all. It survives as a parameter of `run` because it is a fact about
 * the agent that gg states on the wire, and because removing a parameter from a WIT world means
 * rebuilding eleven committed guests for a value four of them never read.
 *
 * `"none"` is the arm an **on-use script** runs under — the code a skill or a memory runs when the
 * agent first reads it. That script is not the agent's turn, so it may not declare the session over,
 * and the host is what tells it so.
 */
export type EndingKind = "standard" | "review" | "none";

/**
 * The scope object a program reaches its loaded **code modules** through: the code of a skill or a
 * memory it has read, bound at `lib.<name>`.
 *
 * It is not a capability module: nothing there is a gg function, the members are whatever the skill
 * or memory exported, and the host already said which key each one got and
 * what it exports when it answered the read. It is bound only when at least one module was handed
 * over, so a run with none has no `lib` identifier at all.
 */
export const LIB_OBJECT = "lib";

/**
 * The name the shared `ToolError` class is bound under, beside its qualified `gg.core.ToolError`.
 *
 * Both, because `catch (error) { if (error instanceof ToolError) … }` is the shape the prompt teaches
 * and a qualified name in a `catch` reads as ceremony, while the qualified one is what a
 * documentation view is keyed by.
 */
export const TOOL_ERROR = "ToolError";

/**
 * The non-enumerable key every bound function carries the name gg knows it by under, so
 * `gg.views.openDocsView(gg.files.readFile)` can be spelled with the function rather than a string.
 *
 * A `Symbol` rather than a property name so it is invisible to a model iterating an object, and here
 * rather than in the shim because both the shim (which writes it) and `gg/views.ts` (which reads it)
 * need the identical symbol.
 */
export const DOCS_NAME = Symbol("gg.docsName");

/**
 * The exported name that implements one gg operation, derived from the operation's own key.
 *
 * Deriving rather than tabulating is what keeps the operation id written in exactly one place. gg's
 * keys are `snake_case` because they are gg's vocabulary; this SDK's exports are `camelCase` because
 * they are TypeScript's, and the two are one transformation apart. `tools/signatures.mjs` checks the
 * derivation against every declaration's own `@ggop`, so a key that does not name its function is a
 * build failure rather than a call that quietly fails to bind.
 */
export function exportedName(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** The module half of an operation id, which is the module the function is declared in. */
export function moduleOf(operation: string): ModuleId {
  return operation.slice(0, operation.indexOf(".")) as ModuleId;
}

/** The key half of an operation id, which is what {@link exportedName} turns into an export. */
export function keyOf(operation: string): string {
  return operation.slice(operation.indexOf(".") + 1);
}
