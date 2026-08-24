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

// A one-line preview of a program for its collapsed row: its first non-blank line, which
// for a program is usually the import or the comment the model opened with — enough to
// tell one turn from the next without opening either.
const PREVIEW_MAX = 160;
function programPreview(message: PooledMessage | undefined): string {
  const content = message?.content;
  if (!content || !content.trim()) return "(no program)";
  const line = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  return (line ?? "").slice(0, PREVIEW_MAX);
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
  const failed = program.status !== "success";
  return (
    <details className={panels.reqTurn}>
      <summary className={panels.reqTurnSummary}>
        <span className={panels.reqCaret} aria-hidden="true">
          ▸
        </span>
        <span className={panels.reqTurnLabel}>Turn {program.turn + 1}</span>
        <span className={panels.progPreview}>{programPreview(response)}</span>
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
        <div className={panels.reqSectionLabel}>Program</div>
        {response?.content ? (
          <ExpandablePre
            content={response.content}
            className={panels.reqContent}
            label={`Turn ${program.turn + 1} program`}
          />
        ) : (
          <p className={panels.reqEmptyResponse}>
            No assistant message — the turn produced only a stop.
          </p>
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
