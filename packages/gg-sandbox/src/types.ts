/**
 * The **model-facing** shapes the tool functions accept and return.
 *
 * These are deliberately not the raw membrane records of `membrane.d.ts`. Three differences matter,
 * and each one exists so a program reads like gg rather than like a WIT file:
 *
 * - **gg's vocabulary, not WIT's.** A status is `in_progress` and a child agent's ending is
 *   `timed_out` — the spellings gg's stores, schemas and tool-calling mode all use. WIT identifiers
 *   cannot contain `_`, so the membrane spells them `in-progress` and `timed-out` and the SDK
 *   translates at the boundary. A model therefore sees one vocabulary in both execution modes,
 *   which matters most where the difference would be *silent*: a comparison against the wrong
 *   spelling is not an error, it is a branch that never runs.
 * - **`number`, not `bigint`.** A `u64` crosses the membrane as a `bigint`, and a `bigint` that
 *   escapes into a program poisons whatever it is folded into: `console.log(JSON.stringify({ n:
 *   writeFile(...) }))` throws `TypeError: BigInt value can't be serialized in JSON`, so the one
 *   line the program meant to show gg is lost. Every wrapper converts at the boundary, so these
 *   types say `number`.
 * - **A discriminated `kind`, not a `tag`/`val` pair.** `readFile` returns `{ kind: "text", … }`, a
 *   shape a model can destructure directly, rather than the component model's nested
 *   `{ tag: "text", val: { … } }`.
 *
 * These declarations are also the **prompt's** type vocabulary: `tools/signatures.mjs` reflects them
 * out of this file's emitted `.d.ts` and gg renders the ones an enabled tool actually references
 * into the system prompt. So a name or a comment here is read by a model, not just by `tsc`.
 */

/**
 * Why a tool call failed — the `code` on a thrown `ToolError`, and the value a catch site branches
 * on instead of matching on prose.
 *
 * This is the model-facing spelling of the membrane's `ErrorCode`; `errors.ts` assigns one into the
 * other, so `tsc` rejects a membrane arm this union has not learned about.
 */
export type ToolErrorCode =
  /** The arguments were malformed, ill-typed, or out of range. */
  | "invalid-argument"
  /** The named file, skill, memory, task, epic, issue, subagent, or model slot does not exist. */
  | "not-found"
  /** Well-formed, but in conflict with the current state: an ambiguous edit, a cycle, a duplicate. */
  | "conflict"
  /** gg refused the call: plan mode, the run's FSM state, or the delegation depth cap. */
  | "refused"
  /** The tool exists but this run's capability set does not offer it. */
  | "unavailable"
  /** A gg-side ceiling was hit: a shell timeout, a store cap, or the run's wall-clock budget. */
  | "limit-exceeded"
  /** The underlying I/O or process failed. */
  | "io-error"
  /** The failure was not classified. */
  | "other";

/** What a command `shell` ran reported when it finished. */
export interface ShellOutput {
  /** The process's exit status; `undefined` when a signal killed it. Zero means success. */
  exitCode: number | undefined;
  /**
   * Merged stdout-then-stderr, tail-truncated at 16 KiB — or, when the run offloads shell output,
   * at the configured line/character ceiling, with a note naming the files holding the whole of it.
   */
  output: string;
  /** Whether the cap cut `output`, dropping the head and keeping the tail. */
  truncated: boolean;
}

/**
 * What `readFile` returned: a text file's window, or a picture's metadata.
 *
 * A picture is a different kind of thing from text, so it is a different case rather than a string
 * that happens to be binary — a program that treats an image as text is caught by the `kind` check
 * instead of silently writing an empty string somewhere. Image *bytes* never enter the program: gg
 * attaches the picture to the turn so the model can look at it directly, which is worth far more
 * than base64 in a variable.
 */
export type FileRead =
  | {
      /** This file is text. */
      kind: "text";
      /** The file's text, or just the requested window under a capped read policy. */
      contents: string;
      /** The 1-based first line returned. */
      firstLine: number;
      /** The 1-based last line returned. */
      lastLine: number;
      /** The file's total line count, so you know whether to page again. */
      totalLines: number;
      /** A 256 KiB byte ceiling cut the returned text. */
      byteTruncated: boolean;
      /** A capped read policy reduced the `limit` you asked for. */
      limitReduced: boolean;
    }
  | {
      /** This file is a picture; gg shows it to you rather than handing you its bytes. */
      kind: "image";
      /** The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`). */
      mediaType: string;
      /** The short format label (`PNG`, `JPEG`, `GIF`, `WebP`). */
      label: string;
      /** The file's size in bytes. */
      bytes: number;
      /** Whether the picture is being attached to this turn for you to look at. */
      shown: boolean;
      /** Why it is not being shown; `undefined` when `shown` is true. */
      notShownReason: string | undefined;
    };

/** One entry `listDir` found: a bare name — join it with the directory you listed — and its kind. */
export interface DirEntry {
  name: string;
  kind: "file" | "directory" | "other";
}

/**
 * How much of the run's durable-memory budget is used, after the call that returned it.
 *
 * Every maximum is optional: each limit can be turned off, and a run's memory strategy applies only
 * some of them, so `undefined` means nothing bounds that axis — check before subtracting.
 */
export interface MemoryUsage {
  /** Memories currently held. */
  count: number;
  /** The most memories this run allows, if it limits the count. */
  maxCount: number | undefined;
  /** Characters of body currently held, across all memories. */
  totalChars: number;
  /** The most characters of body this run allows in total, if it limits the aggregate. */
  maxTotalChars: number | undefined;
  /** Characters the memory index occupies, under a run that keeps one. */
  indexChars: number | undefined;
  /** The most characters the index may occupy, if it is limited. */
  maxIndexChars: number | undefined;
}

/** One memory `searchMemories` matched, and the numbers it was ranked by. */
export interface MemoryHit {
  /** The memory's slug — what `readMemory` takes. */
  name: string;
  /** Its description, or `""` when it was created without one. */
  description: string;
  /** How many of your distinct keywords it matched — the primary ranking. */
  matched: number;
  /** How many times those keywords occur in it — the tiebreak. */
  occurrences: number;
  /** A short window of the memory around its first match. */
  excerpt: string;
}

/** Where a task stands. */
export type TaskStatus = "pending" | "in_progress" | "done";

/** How much of the run's task budget is used, after the call that returned it. */
export interface TaskUsage {
  count: number;
  maxTasks: number;
}

/** Where an issue stands. */
export type IssueStatus = "open" | "in_progress" | "done";

/** How much of the run's board budget is used, after the call that returned it. */
export interface BoardUsage {
  epics: number;
  maxEpics: number;
  issues: number;
  maxIssues: number;
}

/** An epic that was just created: the id its prefix resolved to, and the board budget. */
export interface EpicCreated {
  /** The epic's id — the prefix you gave, upper-cased (`auth` → `AUTH`). Group issues under it
   * with this, and its issues are numbered from it (`AUTH-1`). */
  id: string;
  /** How much of the board budget is used. */
  board: BoardUsage;
}

/** An issue that was just created: the id the board assigned it, and the board budget. */
export interface IssueCreated {
  /** The id the board assigned (`AUTH-1`) — you do not choose it. Use it to block later issues on
   * this one, or to wait for it. */
  id: string;
  /** How much of the board budget is used. */
  board: BoardUsage;
}

/** What a context reclaim actually freed from the live context window. */
export interface ReclaimReport {
  /** Context items dropped from the live window. */
  items: number;
  /** Approximately how many tokens that freed. */
  reclaimedTokens: number;
  /** The workspace paths whose views were evicted. Empty for an archive. */
  paths: string[];
  /** The prose summary of what was reclaimed. */
  detail: string;
}

/**
 * An inclusive span of turn numbers, the unit `archiveThread` moves out of the window.
 *
 * The numbers are the ones on the header of every result you are given, so `{ from: 4, to: 19 }`
 * means exactly the turns you can see numbered 4 through 19 — both ends included.
 */
export interface TurnRange {
  /** The first turn in the span. */
  from: number;
  /** The last turn in the span, inclusive. */
  to: number;
}

/** One archived message that matched a search. */
export interface ArchiveHit {
  /** The archived message's sequence number. */
  seq: number;
  /** Who said it. */
  role: "system" | "user" | "assistant" | "tool";
  /** The message text. */
  text: string;
}

/** What `searchArchive` found. */
export interface ArchiveSearch {
  /**
   * Nothing has been archived yet, so there was nothing to search. Deliberately distinct from a
   * search that ran and matched nothing, so you do not archive again believing the first archive
   * failed.
   */
  archiveEmpty: boolean;
  /** The matches, most recent first, at most 8. */
  hits: ArchiveHit[];
}

/** A child agent that was spawned and is now running in parallel. */
export interface SubagentHandle {
  /** The child's id — pass it to `waitForSubagents` or `sendMessage`. */
  id: string;
  /** The agent profile it runs as. */
  slot: string;
  /** The model actually bound to that agent. */
  modelId: string;
}

/** How a child agent's loop ended — gg's own six words, as the native path also reports them. */
export type AgentEnding =
  /** It finished normally: it called `finish`, and its summary is what it returned. */
  | "completed"
  /** It hit the per-run turn ceiling. */
  | "exhausted"
  /** It passed its wall-clock deadline. */
  | "timed_out"
  /** A model turn failed. */
  | "model_error"
  /** The run's credential was refused. */
  | "auth_error"
  /** An execution ceiling stopped it — consecutive errors, error rate, or cost. */
  | "limit_exceeded";

/** One child agent's collected result. */
export interface SubagentResult {
  /** The child's id. */
  id: string;
  /** How it finished; `undefined` when it produced no return value at all. */
  status: AgentEnding | undefined;
  /** Its final message. */
  summary: string;
}

/** What a completed multi-stage fan-out produced. */
export interface WorkflowReport {
  /** The workflow's id. */
  workflowId: string;
  /** How many stages ran. */
  stages: number;
  /** The final stage's collected results, in dispatch order. */
  results: string[];
}

/** What a best-of-K speculation merged. */
export interface SpeculationReport {
  /** The winning attempt's agent id. */
  winnerId: string;
  /** How many attempts ran. */
  attempts: number;
  /** The judge's one-sentence rationale, when it gave one. */
  rationale: string | undefined;
  /** The merge report. */
  summary: string;
}
