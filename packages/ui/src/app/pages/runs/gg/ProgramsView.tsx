// The Programs view: one responses-as-code agent's replies as the programs they were,
// and whether each compiled and ran.
//
// The Requests view already holds every one of these responses — as the `Reply` row at
// the bottom of each turn, under the turn's whole request. That is the right shape for
// reading what the model was *sent*, and the wrong one for the question an operator of
// a code agent asks first: which of its programs worked? Answering it there means
// opening each turn, scrolling past its request, and then looking elsewhere (the
// activity feed, the errors card) for the verdict. This view is that question answered
// directly: one collapsed row per turn carrying the verdict as its status — success,
// compile, runtime — so the rows worth opening are the ones that stand out, and each
// opens onto the program and the error it met, and nothing else.

import type { GgTurnErrorType } from "@test-cabinet/run-record/gg";
import panels from "./GgPanels.module.scss";
import type {
  PooledMessage,
  ProgramStatus,
  ProgramTurn,
} from "./useGgRunState";
import { errorTypeLabel, shortTokens } from "./useGgRunState";
import { ExpandablePre } from "./MessageOverlay";

// The word each status reads as on its pill — the operator's triage vocabulary rather
// than the wire's: "compile" and "runtime" name where the failure happened, which is
// what decides whether the program is worth reading.
const STATUS_LABELS: Record<ProgramStatus, string> = {
  success: "success",
  compile: "compile",
  runtime: "runtime",
  other: "error",
};

// The name of the one tool a responses-as-code turn is offered — mirrors gg's
// `SUBMIT_PROGRAM_TOOL`. A reply's programs are the `program` strings of its calls to
// it, in order: the reply's text is not a program (a code-mode reply usually has none),
// so this view reads the calls and never the content.
export const SUBMIT_PROGRAM_TOOL = "submit_program";

// One submission the reply made: the program it carried, or null for a call that
// carried none (a missing or non-string `program` argument — gg answers it with a
// refusal and runs nothing), and the id the program library assigned it — the body of
// the `tool` message that acknowledged the call, which is the handle `programs.get`
// takes for the program. Null when there is no id: the call carried no program, the
// agent has no program library (the acknowledgement is then the bare `ok`), or the
// acknowledgement is not in the pool.
export interface SubmittedProgram {
  callId: string;
  program: string | null;
  id: string | null;
}

// The acknowledgement gg answers a call that carried no program library with — mirrors
// gg's `SUBMIT_PROGRAM_ACK`.
const SUBMIT_PROGRAM_ACK = "ok";

// Whether this agent keeps a program library, read off the acknowledgements in its
// pool: an agent with one is acknowledged with an id on every program-carrying call,
// and an agent without one with the fixed `ok` on every one — so any program's
// acknowledgement that differs from `ok` proves the library, and then even a literal
// `ok` is an id (a real cuid2 at the 2-character length). The one transcript this
// cannot decide is an agent whose every program-carrying ack reads `ok`: overwhelmingly
// a library-less agent, so that is how it is shown.
function libraryArmed(
  pool: ReadonlyMap<string, PooledMessage>,
  acks: ReadonlyMap<string, string>,
): boolean {
  for (const entry of pool.values()) {
    if (entry.role !== "assistant") continue;
    for (const call of entry.toolCalls) {
      if (call.name !== SUBMIT_PROGRAM_TOOL) continue;
      if (typeof call.args.program !== "string") continue;
      const ack = acks.get(call.id)?.trim() ?? "";
      if (ack !== "" && ack !== SUBMIT_PROGRAM_ACK) return true;
    }
  }
  return false;
}

// Every `submit_program` call in a pooled reply, in the order the model wrote them —
// gg runs all of them, sequentially, whether or not an earlier one failed, so every one
// is a program the turn ran and every one is shown. The pool, when given, is where each
// call's acknowledgement is read from, for the id it carries.
export function submittedPrograms(
  message: PooledMessage | undefined,
  pool?: ReadonlyMap<string, PooledMessage>,
): SubmittedProgram[] {
  if (!message) return [];
  const acks = new Map<string, string>();
  if (pool) {
    for (const entry of pool.values()) {
      if (entry.role === "tool" && entry.toolCallId != null) {
        acks.set(entry.toolCallId, entry.content ?? "");
      }
    }
  }
  const armed = pool != null && libraryArmed(pool, acks);
  return message.toolCalls
    .filter((call) => call.name === SUBMIT_PROGRAM_TOOL)
    .map((call) => {
      const program = call.args.program;
      const source = typeof program === "string" ? program : null;
      const ack = acks.get(call.id)?.trim() ?? "";
      const id =
        source != null && ack !== "" && (armed || ack !== SUBMIT_PROGRAM_ACK)
          ? ack
          : null;
      return { callId: call.id, program: source, id };
    });
}

// A one-line preview of a turn's programs for its collapsed row: the first program's
// first non-blank line, which is usually the import or the comment the model opened
// with — enough to tell one turn from the next without opening either — suffixed with
// the count when the reply submitted more than one.
const PREVIEW_MAX = 160;
function programPreview(submissions: SubmittedProgram[]): string {
  const first = submissions.find((s) => s.program != null)?.program;
  if (first == null || !first.trim()) return "(no program)";
  const line = first
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  const preview = (line ?? "").slice(0, PREVIEW_MAX);
  return submissions.length > 1
    ? `${preview} · ${submissions.length} programs`
    : preview;
}

// What the specific error type is called in the entry's error caption: the contract's
// label, or the wire id with its underscores spaced out for a type this console has not
// heard of — the same allowance the Errors card makes.
function errorCaption(
  status: ProgramStatus,
  type: GgTurnErrorType | null,
): string {
  const base =
    status === "compile"
      ? "Compile error"
      : status === "runtime"
        ? "Runtime error"
        : "Error";
  return type != null ? `${base} · ${errorTypeLabel(type)}` : base;
}

// One program — its collapsed row and, opened, the program itself followed by whatever
// went wrong. Collapsed by default, every one of them: unlike a request log, which a
// live watcher reads newest-first, a program list is scanned by status and opened
// selectively, and a newest-open default would put the one row the operator did not ask
// for in front of the rest.
function ProgramEntry({
  program,
  pool,
}: {
  program: ProgramTurn;
  pool: Map<string, PooledMessage>;
}) {
  const response =
    program.responseId != null ? pool.get(program.responseId) : undefined;
  const submissions = submittedPrograms(response, pool);
  const failed = program.status !== "success";
  return (
    <details className={panels.reqTurn}>
      <summary className={panels.reqTurnSummary}>
        <span className={panels.reqCaret} aria-hidden="true">
          ▸
        </span>
        <span className={panels.reqTurnLabel}>Turn {program.turn + 1}</span>
        <span className={panels.progPreview}>
          {programPreview(submissions)}
        </span>
        {/* An empty cell rather than a zero for a response whose tokens were not
            estimated, as the Requests view's message rows do. */}
        <span className={panels.reqTokens}>
          {response?.tokens != null ? shortTokens(response.tokens) : ""}
        </span>
        <span className={panels.progStatus} data-status={program.status}>
          {STATUS_LABELS[program.status]}
        </span>
      </summary>
      <div className={panels.reqTurnBody}>
        {/* One section per `submit_program` call, in the order the model wrote them —
            all of them, because gg ran all of them. A turn that submitted exactly one
            is captioned "Program"; several are numbered so the error that follows can
            be read against the chain it came from. The id the program library assigned
            each one follows the caption, so a `programs.get` in a later program can be
            read back to the program it fetched. */}
        {submissions.length === 0 ? (
          <>
            <div className={panels.reqSectionLabel}>Program</div>
            <p className={panels.reqEmptyResponse}>
              No program. The reply made no {SUBMIT_PROGRAM_TOOL} call.
            </p>
          </>
        ) : (
          submissions.map((submission, index) => {
            const caption =
              submissions.length === 1
                ? "Program"
                : `Program ${index + 1} of ${submissions.length}`;
            return (
              <div key={submission.callId}>
                <div className={panels.reqSectionLabel}>
                  {caption}
                  {submission.id != null && (
                    <>
                      {" · "}
                      <code>{submission.id}</code>
                    </>
                  )}
                </div>
                {submission.program != null ? (
                  <ExpandablePre
                    content={submission.program}
                    className={panels.reqContent}
                    label={`Turn ${program.turn + 1} ${caption.toLowerCase()}`}
                  />
                ) : (
                  <p className={panels.reqEmptyResponse}>
                    The call carried no program.
                  </p>
                )}
              </div>
            );
          })
        )}
        {failed && (
          <>
            <div className={panels.reqSectionLabel}>
              {errorCaption(program.status, program.errorType)}
            </div>
            {/* The execution's own message where one was recorded; a turn that failed
                without one (its reply was never a program, so nothing ran) is
                captioned by its type alone, which is the whole of what gg knows. */}
            {program.error != null ? (
              <ExpandablePre
                content={program.error}
                className={`${panels.reqContent} ${panels.progError}`}
                label={`Turn ${program.turn + 1} error`}
              />
            ) : (
              <p className={panels.reqEmptyResponse}>
                {program.executed
                  ? "The execution recorded no message."
                  : "The program was never run."}
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}

/**
 * The per-agent Programs view — each of one responses-as-code agent's replies as a
 * program with its compile/run verdict, and the error it met when it failed.
 */
export function ProgramsView({
  programs,
  pool,
  live,
}: {
  programs: ProgramTurn[];
  pool: Map<string, PooledMessage>;
  live: boolean;
}) {
  if (programs.length === 0) {
    return (
      <p className={panels.empty}>
        {live ? "Waiting for the first program…" : "No programs were recorded."}
      </p>
    );
  }
  return (
    <div className={panels.requests}>
      {programs.map((program) => (
        <ProgramEntry key={program.turn} program={program} pool={pool} />
      ))}
    </div>
  );
}
