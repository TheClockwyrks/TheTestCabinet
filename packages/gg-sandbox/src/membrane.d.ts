/**
 * The JavaScript view of `crates/gg/wit/gg-sandbox.wit` — the membrane between a model's program
 * and gg.
 *
 * This file emits **no code**. `componentize-js` injects the real bindings for these module
 * specifiers when it bakes the component; all this declaration does is teach `tsc` their shape so
 * the SDK in `src/tools/` type-checks against them. It is the one hand-maintained mirror in the
 * package, and it exists because there is no generator that produces TypeScript declarations from a
 * WIT world.
 *
 * **Why it cannot silently drift.** Three independent gates sit under it:
 *
 * 1. If it disagrees with the WIT, `componentize-js` fails to link when `build.sh` refreshes the
 *    artifact — it resolves every static import against the target world.
 * 2. If the WIT changes and the component is *not* refreshed, the committed component's imports no
 *    longer match the host's `bindgen!`-generated linker and instantiation fails loudly in gg's
 *    first sandbox unit test.
 * 3. Argument order and field names are gated by the per-tool crossing test in
 *    `crates/gg/src/sandbox.test.rs`, which drives one program per tool against the real component
 *    and asserts the JSON the host's tool invoker saw.
 *
 * **The canonical WIT-to-JS mapping** the component model applies, and which every declaration
 * below follows:
 *
 * | WIT                                  | JS                                                      |
 * | ------------------------------------ | ------------------------------------------------------- |
 * | `bool`                               | `boolean`                                                |
 * | `u8` / `u16` / `u32` / `s32` / `f64` | `number`                                                 |
 * | `u64` / `s64`                        | `bigint`                                                 |
 * | `string`                             | `string`                                                 |
 * | `list<T>`                            | `T[]`                                                    |
 * | `option<T>`                          | a **required positional** parameter typed `T \| undefined` |
 * | `record`                             | an object with camelCased fields                         |
 * | `enum`                               | the arm name as a string literal                         |
 * | `variant`                            | `{ tag: "case" } \| { tag: "case"; val: T }`             |
 * | `result<T, E>`                       | returns `T`; **throws** `E`                              |
 *
 * Two consequences of that table drive the whole SDK: an `option<T>` is a *positional* parameter
 * that must be passed explicitly as `undefined` rather than omitted, and a `result` error is
 * **thrown** rather than returned — and it arrives as a bare record, not an `Error`, which is what
 * `src/errors.ts` normalises.
 */

/**
 * The types shared across the tool interfaces. It declares no functions; it exists so one
 * `tool-error` crosses the whole membrane rather than one per family.
 */
declare module "test-cabinet:gg/types" {
  /**
   * Why a call failed, in the vocabulary a program branches on. gg classifies every failure at the
   * point it raises it, so this is never derived by matching on prose.
   *
   * The model-facing spelling of this union is re-declared in `src/types.ts` as `ToolErrorCode`, so
   * the signature catalogue can quote the arms to a model; `src/errors.ts` assigns a value of this
   * type into that one, which is what makes `tsc` reject a WIT arm the model-facing union has not
   * learned about.
   */
  export type ErrorCode =
    | "invalid-argument"
    | "not-found"
    | "conflict"
    | "refused"
    | "unavailable"
    | "limit-exceeded"
    | "io-error"
    | "other";

  /** A failed call, as it crosses the membrane: the thrown value before `errors.ts` wraps it. */
  export interface ToolErrorRecord {
    /** The failure class, so a catch site branches on a value rather than on prose. */
    code: ErrorCode;
    /** The gg tool that failed (`read_file`, `spawn_subagent`, …). */
    tool: string;
    /** The model-facing guidance — the same text the native tool-calling path shows. */
    message: string;
  }

  /**
   * A three-way edit of an optional text field: leave it, empty it, or replace it. The SDK lowers
   * `undefined` / `null` / a string onto these three cases so a model never writes a tagged union.
   */
  export type TextEdit = { tag: "keep" } | { tag: "clear" } | { tag: "set"; val: string };
}

/** Running commands in the workspace. */
declare module "test-cabinet:gg/shell" {
  /** What a completed process reported. */
  export interface ShellOutput {
    /** The exit status; `undefined` when a signal terminated the process. */
    exitCode: number | undefined;
    /** Merged stdout-then-stderr, tail-truncated at gg's 16 KiB cap. */
    output: string;
    /** Whether the cap cut `output` (the head was dropped, the tail kept). */
    truncated: boolean;
  }

  /** Run a command with `sh -c` in the workspace directory. */
  export function shell(command: string, timeoutSecs: number | undefined): ShellOutput;
}

/** Reading and writing files. A relative path resolves against the workspace root. */
declare module "test-cabinet:gg/files" {
  /** A text file, or the window of one this run's read policy returned. */
  export interface TextRead {
    /** The file's text, or just the requested window under a capped read policy. */
    contents: string;
    /** The 1-based first line returned. */
    firstLine: number;
    /** The 1-based last line returned. */
    lastLine: number;
    /** The file's total line count, so a program knows whether to page again. */
    totalLines: number;
    /** The 256 KiB byte ceiling cut the returned text. */
    byteTruncated: boolean;
  }

  /**
   * A picture. The bytes never enter the program — a read of an image describes it. Whether the
   * picture is also put in front of the model depends on which call produced this: `view.openFile`
   * shows it, a bare `fs.readFile` does not (and says so in `notShownReason`).
   */
  export interface ImageRead {
    /** The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`). */
    mediaType: string;
    /** The short format label (`PNG`, `JPEG`, `GIF`, `WebP`). */
    label: string;
    /** The file's size in bytes. */
    bytes: bigint;
    /** Whether the picture is being attached to this turn for the model to look at. */
    shown: boolean;
    /** Why it is not being shown; `undefined` when `shown` is true. */
    notShownReason: string | undefined;
  }

  /** What a read returned: text, or a picture. The format is detected by magic bytes. */
  export type FileReadRaw = { tag: "text"; val: TextRead } | { tag: "image"; val: ImageRead };

  /** What a directory entry is. */
  export type EntryKind = "file" | "directory" | "other";

  /** One directory entry: a name (not a path) and what kind of thing it is. */
  export interface DirEntry {
    name: string;
    kind: EntryKind;
  }

  /** Read a workspace file. `offset`/`limit` apply only under a capped read policy. */
  export function readFile(
    path: string,
    offset: number | undefined,
    limit: number | undefined,
  ): FileReadRaw;
  /** Write UTF-8 text to a workspace file. Returns the number of bytes written. */
  export function writeFile(path: string, contents: string): bigint;
  /** Replace the single exact occurrence of `oldString` with `newString`. */
  export function editFile(path: string, oldString: string, newString: string): void;
  /** List a workspace directory, sorted by name. `undefined` lists the workspace root. */
  export function listDir(path: string | undefined): DirEntry[];
}

/**
 * The convenience wrappers built on a tool without being one.
 *
 * Imported rather than composed in the guest out of {@link readFile}, so the host can tell the two
 * apart: a helper the guest built would arrive as its wrapped tool's call and be recorded under a
 * function the model never wrote.
 */
declare module "test-cabinet:gg/helpers" {
  /** Read a text file's contents. A path naming a picture is `invalid-argument`. */
  export function readTextFile(
    path: string,
    offset: number | undefined,
    limit: number | undefined,
  ): string;
}

/** The authored skill library. */
declare module "test-cabinet:gg/skills" {
  /** Read an authored skill by name, returning its body with the front matter stripped. */
  export function readSkill(name: string): string;
}

/** Durable memories that survive context compaction. */
declare module "test-cabinet:gg/memories" {
  /** A memory to record or revise. */
  export interface MemoryInput {
    /** The unique short name the memory is addressed by. */
    name: string;
    /** A one-line description of what it holds. */
    description: string;
    /** The memory body. */
    body: string;
    /** Reusable code, as a TypeScript module, bound at `lib.<name>` in every later program. */
    code: string | undefined;
    /** A script to run once, when the memory first comes into use. */
    onUse: string | undefined;
  }

  /** How much of the memory budget is used. Every maximum is absent when nothing bounds it. */
  export interface MemoryUsage {
    /** Memories currently held. */
    count: number;
    /** The most memories this run allows. */
    maxCount: number | undefined;
    /** Characters of body currently held, across all memories. */
    totalChars: number;
    /** The most characters of body this run allows. */
    maxTotalChars: number | undefined;
    /** Characters the pinned index occupies. */
    indexChars: number | undefined;
    /** The most characters the index may occupy. */
    maxIndexChars: number | undefined;
  }

  /** A revision to a memory: replace the one exact occurrence of `search` with `replace`. */
  export interface MemoryEdit {
    /** The memory's slug. */
    name: string;
    /** The exact text to replace, which must occur exactly once. */
    search: string;
    /** What to put in its place; empty cuts the text out. */
    replace: string;
  }

  /** One memory a search matched. */
  export interface MemoryHit {
    /** The memory's slug. */
    name: string;
    /** Its description, or empty. */
    description: string;
    /** How many distinct keywords it matched. */
    matched: number;
    /** How many times those keywords occur in it. */
    occurrences: number;
    /** A short window around its first match. */
    excerpt: string;
  }

  /** Record a new durable memory. */
  export function writeMemory(memory: MemoryInput): MemoryUsage;
  /** Replace an existing memory's description and body. */
  export function updateMemory(memory: MemoryInput): MemoryUsage;
  /** Record a new memory file, kept out of the context window until read. */
  export function createMemory(memory: MemoryInput): MemoryUsage;
  /** Read one memory's contents back, by slug. */
  export function readMemory(name: string): string;
  /** Revise a memory in place. */
  export function editMemory(edit: MemoryEdit): MemoryUsage;
  /** Find the memories mentioning any of `keywords`, best first. */
  export function searchMemories(keywords: string[]): MemoryHit[];
  /** Evict a memory by name. */
  export function deleteMemory(name: string): MemoryUsage;
}

/** The task DAG. */
declare module "test-cabinet:gg/tasks" {
  import type { TextEdit } from "test-cabinet:gg/types";

  /**
   * Where a task stands, in the WIT's spelling. WIT identifiers cannot contain `_`, so the store's
   * `in_progress` is `in-progress` here; the SDK translates, so a model sees gg's spelling in both
   * execution modes.
   */
  export type TaskStatusRaw = "pending" | "in-progress" | "done";

  /** A task to add. */
  export interface TaskInput {
    /** The unique short id other tasks reference it by. */
    id: string;
    /** The task title. */
    title: string;
    /** An optional longer description. */
    description: string | undefined;
    /** Ids of tasks that must finish first. */
    blockedBy: string[];
  }

  /** A revision of a task. Every field is optional; at least one must be supplied. */
  export interface TaskPatch {
    title: string | undefined;
    description: TextEdit;
    status: TaskStatusRaw | undefined;
  }

  /** How much of the task budget is used. */
  export interface TaskUsage {
    count: number;
    maxTasks: number;
  }

  /** Add a task to the DAG. */
  export function addTask(task: TaskInput): TaskUsage;
  /** Revise a task's title, description, and/or status. */
  export function updateTask(id: string, patch: TaskPatch): void;
  /** Replace a task's full blocker set. */
  export function setBlockedBy(id: string, blockedBy: string[]): void;
  /** Mark a task done. */
  export function completeTask(id: string): void;
  /** Remove a task and every blocker edge pointing at it. */
  export function removeTask(id: string): TaskUsage;
}

/** The epic/issue board. */
declare module "test-cabinet:gg/board" {
  import type { TextEdit } from "test-cabinet:gg/types";

  /** Where an issue stands, in the WIT's spelling (see `TaskStatusRaw`). */
  export type IssueStatusRaw = "open" | "in-progress" | "done";

  /** How an issue's epic grouping changes: leave it, detach it, or set it. */
  export type EpicAssignment = { tag: "keep" } | { tag: "ungroup" } | { tag: "set"; val: string };

  /** An epic to create. `prefix` is 3-6 letters; upper-cased it becomes the epic's id. */
  export interface EpicInput {
    prefix: string;
    title: string;
    description: string;
  }

  /** An issue to create — a heavyweight, self-contained, dispatchable unit of work. The board
   * assigns its id. */
  export interface IssueInput {
    title: string;
    description: string | undefined;
    inScope: string;
    outOfScope: string;
    completionCriteria: string;
    blockedBy: string[];
    epicId: string | undefined;
    agent: string;
    reviewers: string[];
  }

  /** A revision of an issue. Every field is optional; at least one must be supplied. */
  export interface IssuePatch {
    title: string | undefined;
    description: TextEdit;
    inScope: string | undefined;
    outOfScope: string | undefined;
    completionCriteria: string | undefined;
    status: IssueStatusRaw | undefined;
    epic: EpicAssignment;
  }

  /** How much of the board budget is used. */
  export interface BoardUsage {
    epics: number;
    maxEpics: number;
    issues: number;
    maxIssues: number;
  }

  /** An epic the board just created: the id its prefix resolved to, plus the board budget. */
  export interface EpicCreated {
    id: string;
    board: BoardUsage;
  }

  /** An issue the board just created: the id it assigned, plus the board budget. */
  export interface IssueCreated {
    id: string;
    board: BoardUsage;
  }

  /** Create an epic to group related issues, returning the id its prefix resolved to. */
  export function createEpic(epic: EpicInput): EpicCreated;
  /** Create a self-contained, dispatchable issue, returning the id the board assigned it. */
  export function createIssue(issue: IssueInput): IssueCreated;
  /** Revise an issue. */
  export function updateIssue(id: string, patch: IssuePatch): void;
  /** Replace an issue's full blocker set. */
  export function setIssueBlockedBy(id: string, blockedBy: string[]): void;
  /** Remove an epic. Its issues are kept and ungrouped. */
  export function removeEpic(id: string): BoardUsage;
  /** Remove an issue and every blocker edge pointing at it. */
  export function removeIssue(id: string): BoardUsage;
  /** Register a deferred wait on an issue and return an acknowledgement; the run suspends after the
   * program ends, not inside it. */
  export function waitForIssue(id: string): string;
}

/** Managing the agent's own context window. */
declare module "test-cabinet:gg/context" {
  /** What a reclaim actually freed from the live context window. */
  export interface ReclaimReport {
    /** Context items dropped from the live window. */
    items: number;
    /** Approximately how many tokens that freed. */
    reclaimedTokens: number;
    /** The workspace paths whose views were evicted. Empty for an archive. */
    paths: string[];
    /** The same prose the native tool-calling path shows the model. */
    detail: string;
  }

  /** Who said an archived message. */
  export type MessageRole = "system" | "user" | "assistant" | "tool";

  /** One archived message that matched a search. */
  export interface ArchiveHit {
    /** The archived message's sequence number. */
    seq: number;
    /** Who said it. */
    role: MessageRole;
    /** The message text. */
    text: string;
  }

  /** What a search of the archive found. */
  export interface ArchiveSearch {
    /** Nothing has been archived yet — distinct from a search that ran and matched nothing. */
    archiveEmpty: boolean;
    /** The matches, most recent first, capped at gg's 8-hit ceiling. */
    hits: ArchiveHit[];
  }

  /**
   * An inclusive span of turn numbers, as read off the header on each of your results. Spelled
   * `start`/`end` because `from` is a WIT keyword; the SDK presents it as `{ from, to }`.
   */
  export interface TurnRange {
    /** The first turn in the span. */
    start: number;
    /** The last turn in the span, inclusive. */
    end: number;
  }

  /** Drop file contents from the context window. `undefined` drops every file view. */
  export function evictFileView(path: string | undefined): ReclaimReport;
  /** Move whole turns out of the window, named by the turn numbers on your results. */
  export function archiveThread(ranges: TurnRange[]): ReclaimReport;
  /** Search archived history (case-insensitive substring). */
  export function searchArchive(query: string): ArchiveSearch;
  /**
   * Compact the context window: gg drops the detailed thread and restarts it from `summary`, plus
   * a fresh read of each path in `files`. Registered, not performed — the loop rewrites the window
   * once the program has ended.
   */
  export function compact(summary: string, files: string[]): void;
}

/**
 * Ending the session — the model-facing membrane functions that are not gg tools.
 *
 * They have their own interface for the same reason they have their own catalogue array: no
 * capability offers them, nothing dispatches them, and one group of them is bound into every
 * program's scope, so folding them in among the tool interfaces would perturb the one-to-one
 * correspondence those hold with gg's tool vocabulary. `src/session.ts` is their only importer.
 *
 * Which group is bound is the host's decision, passed to `run` as the agent's role.
 */
declare module "test-cabinet:gg/session" {
  /**
   * Declare the work complete; `summary` becomes the session's final text.
   *
   * The host sets a flag in the agent's own context and returns. Nothing stops the program: a
   * further call replaces the declaration, and the host revokes the flag itself if the program goes
   * on to fail. It **throws** `ToolErrorRecord` with code `invalid-argument` only for an empty
   * summary.
   */
  export function finish(summary: string): void;
  /** Declare the work under review acceptable. Ends the session under the same flag rules. */
  export function approve(): void;
  /**
   * Declare the work under review unacceptable, listing what must change. Ends the session under the
   * same flag rules. **Throws** `ToolErrorRecord` with code `invalid-argument` for an empty list or a
   * blank item.
   */
  export function requestChanges(items: string[]): void;
}

/**
 * Documentation lookup — the second model-facing carve-out, bound into every program's scope and
 * never a gg tool. `src/tools/docs.ts` is its only importer.
 */
declare module "test-cabinet:gg/docs" {
  /** One function in an API object's directory. */
  export interface FunctionSummary {
    /** The function name on its object — `readFile` in `fs.readFile(...)`. */
    name: string;
    /** A one-line description of what the function does. */
    summary: string;
  }

  /** List one API object's bound functions, each with a one-line summary. */
  export function listFunctions(object: string): FunctionSummary[];
}

/**
 * Putting material into the agent's own context window — the third model-facing carve-out, beside
 * `session` and `docs`, and never a gg tool. `src/tools/views.ts` is its only importer.
 *
 * Four of the five functions are bound into every program's scope whatever a run enables, exactly
 * as `finish` is; `open-file-view` is a read, so the shim binds it only when `read_file` is enabled.
 * Cataloguing any of them as a tool would break the `boundTools() == ALL_TOOL_NAMES` bijection the
 * committed component is checked against, which is why they have their own interface.
 */
declare module "test-cabinet:gg/views" {
  import type { FileReadRaw } from "test-cabinet:gg/files";

  /** Which of the three kinds a view is, in the WIT's spelling. */
  export type ViewKindRaw = "file" | "text" | "docs";

  /** The line window a paged file view covers. */
  export interface ViewRegionRaw {
    /** The 1-based first line the view shows. */
    offset: number;
    /** How many lines it shows. */
    limit: number;
  }

  /** One view currently open in the agent's context window. */
  export interface OpenViewRaw {
    /** Whether it is a file, text, or documentation view. */
    kind: ViewKindRaw;
    /** What `closeView` takes: a file view's path, a text view's label, or a docs view's function name. */
    selector: string;
    /** Roughly what holding it costs, in tokens. A `u64`, so a `bigint` here. */
    tokens: bigint;
    /** The window a paged file view covers; `undefined` for whole-file and text views. */
    region: ViewRegionRaw | undefined;
  }

  /** Read a workspace file and open a view of it. Returns exactly what `readFile` returns. */
  export function openFileView(
    path: string,
    offset: number | undefined,
    limit: number | undefined,
  ): FileReadRaw;
  /** Open, or replace, the text view keyed by `label`. */
  export function openTextView(label: string, body: string): void;
  /** Open, or replace, the documentation view for the function called `name`. */
  export function openDocsView(name: string): void;
  /** Close every view carrying `selector`, and return how many were closed. */
  export function closeView(selector: string): number;
  /** What is open in the agent's window right now. Cannot fail. */
  export function currentViews(): OpenViewRaw[];
}

/**
 * The library of programs this agent has already run — the fourth model-facing carve-out, beside
 * `session`, `docs` and `views`, and never a gg tool. `src/tools/programs.ts` is its only importer.
 *
 * Unlike the other three the shim binds it conditionally, from the `library` flag the host passes to
 * `run` rather than from the enabled tool set: the program library is gated by a capability, and no
 * gg tool answers to it.
 */
declare module "test-cabinet:gg/programs" {
  /** One program this agent ran, as `history` lists it — its shape, never its source. */
  export interface ProgramSummaryRaw {
    /** The turn it ran on — what `get` takes. */
    turn: number;
    /** How many lines of source it was. */
    lines: number;
    /** How many characters of source it was. */
    chars: number;
    /** Whether it ran to its end. */
    ok: boolean;
    /** The error it ended with, when it did not. */
    error: string | undefined;
  }

  /** The programs this agent has run, oldest first. Cannot fail. */
  export function history(): ProgramSummaryRaw[];
  /** The source of one program as it was run; `undefined` is the most recent. */
  export function get(turn: number | undefined): string;
  /** Register a program for gg to run in place of this one, once this one has ended. */
  export function rerun(source: string): void;
}

/** Delegating work to child agents. */
declare module "test-cabinet:gg/delegation" {
  /** What a child agent is asked to do — exactly one of a written brief or a board issue. */
  export type SubagentBrief = { tag: "prompt"; val: string } | { tag: "issue"; val: string };

  /** A spawn request. */
  export interface SpawnRequest {
    /** The agent to run the child as — one of the agents you may spawn. */
    agent: string;
    /** What the child should do. */
    task: SubagentBrief;
  }

  /** A spawned child. */
  export interface SubagentHandle {
    /** The child's id. */
    id: string;
    /** The agent profile it runs as. */
    slot: string;
    /** The model actually bound to that agent. */
    modelId: string;
  }

  /** How a child agent finished. `limit-exceeded` is a child an execution ceiling stopped. */
  export type AgentStatus =
    | "completed"
    | "exhausted"
    | "timed-out"
    | "model-error"
    | "auth-error"
    | "limit-exceeded";

  /** One collected child result. */
  export interface SubagentResult {
    /** The child's id. */
    id: string;
    /** How it finished; `undefined` when it produced no return value at all. */
    status: AgentStatus | undefined;
    /** Its final message. */
    summary: string;
  }

  /** Delegate scoped work to a child agent; returns immediately with its handle. */
  export function spawnSubagent(request: SpawnRequest): SubagentHandle;
  /** Wait for the named children — or, with `undefined`, every outstanding child. */
  export function waitForSubagents(ids: string[] | undefined): SubagentResult[];
  /** Deliver a message to a running child's inbox. */
  export function sendMessage(agentId: string, message: string): void;
  /** Declare a move to another state of the machine driving this agent; performed after the turn. */
  export function transitionState(state: string, note: string | undefined): void;
  /** Declare that this session continues as another agent; performed after the turn. */
  export function exec(agent: string, prompt: string | undefined): void;
  /** Register a copy of this agent; its handle comes back now, the copy starts after the turn. */
  export function fork(prompt: string): SubagentHandle;
}

/**
 * The channel the interpreter **shim** reports back to gg through.
 *
 * Deliberately not part of the model-facing surface: it is absent from the signature catalogue,
 * absent from the system prompt, and never bound into a program's scope. A program reaches it only
 * indirectly — through `console.*`, by throwing, or by deferring work into a microtask.
 */
declare module "test-cabinet:gg/feedback" {
  /** What kind of failure a program hit, so gg can pick the right feedback and telemetry. */
  export type ErrorKind = "tool-failure" | "unknown-name" | "other";

  /** A program that did not run to its end. */
  export interface ProgramError {
    /** The failure class. */
    kind: ErrorKind;
    /** The rendered message, already naming the tool or the available identifiers. */
    message: string;
    /** Where in the *program* it happened (`line 5, column 12`), or `undefined`. */
    location: string | undefined;
  }

  /**
   * One line the program produced with `console.*`. The host caps how much it keeps, and what it
   * keeps goes to the run's **operator** — the run record and the console. It is not a channel into
   * the model's context: material a program wants to see on its next turn goes through
   * `test-cabinet:gg/views` instead, one prompt message per open view.
   */
  export function log(line: string): void;
  /**
   * The program ended with a `return` that carried a value, which is discarded. Called at most once
   * per run, so the host can tell the model to open a view on it instead.
   */
  export function noteReturn(): void;
  /** A tool call happened after the program ended. Called at most once per run. */
  export function reportDeferred(note: string): void;
  /**
   * The program threw and did not run to its end. Called at most once per run — and what revokes a
   * completion the same program declared.
   */
  export function reportError(error: ProgramError): void;
  /**
   * One of the code modules handed to `run` threw while it was being evaluated, so `lib.<name>` is
   * an empty object. Reported rather than raised: a broken module belongs to whoever authored the
   * skill or wrote the memory, not to the program that merely has it in scope.
   */
  export function reportModuleError(name: string, message: string): void;
}
