// The Shell view: every command line gg ran on one agent's behalf, with its exit code
// as the verdict and its streams behind the row.
//
// The list is what RAN rather than what the model asked for. All three of gg's command
// paths land here — the `shell` tool, a responses-as-code program's `system.shell(…)`,
// and a hook's commands — and the origin chip says which, so the commands gg ran without
// the model asking (a hook's) stay distinguishable from the ones the model issued. Each
// row collapses to the command and its verdict, so the rows worth opening are the ones
// that stand out, and each opens onto the command's own stdout and stderr as the `shell`
// telemetry event capped them.

import type {
  GgShellCwd,
  GgShellOrigin,
} from "@clockwyrks/run-record/gg-session-record";
import panels from "./GgPanels.module.scss";
import type { ShellCommandEntry } from "./useGgRunState";
import { ExpandablePre } from "./MessageOverlay";

// What each origin reads as on its chip — the wire's own words, which are already the
// operator's: which of gg's three command paths issued the line.
const ORIGIN_LABELS: Record<GgShellOrigin, string> = {
  tool: "tool",
  program: "program",
  hook: "hook",
};

// The chip's hover text: what the origin means for who asked.
const ORIGIN_TITLES: Record<GgShellOrigin, string> = {
  tool: "Issued by the model, as a shell tool call.",
  program: "Issued by the model, from a program's system.shell(…) call.",
  hook: "Issued by gg, as a hook's command — the model never asked for it.",
};

// Where the command ran, as the row states it: nothing for the agent's own workspace
// root (the overwhelmingly common case, not worth a cell), the relative path beneath
// it, or the absolute path for a command that ran outside the workspace entirely.
export function cwdLabel(cwd: GgShellCwd): string | null {
  switch (cwd.type) {
    case "workspace":
      return null;
    case "relative":
      return cwd.path;
    case "absolute":
      return cwd.path;
  }
}

// One stream's section caption, carrying the truncation as part of the caption when the
// telemetry cap dropped leading output — the reader of a tail has to know it is one.
function streamCaption(name: string, dropped: number): string {
  return dropped > 0
    ? `${name} · first ${dropped.toLocaleString()} characters dropped`
    : name;
}

// One stream of an opened row: its caption and its text, or a note for a stream the
// process never wrote to — which is a fact about the command, not a gap in the record.
function StreamSection({
  caption,
  content,
  label,
}: {
  caption: string;
  content: string;
  label: string;
}) {
  return (
    <>
      <div className={panels.reqSectionLabel}>{caption}</div>
      {content !== "" ? (
        <ExpandablePre
          content={content}
          className={panels.reqContent}
          label={label}
        />
      ) : (
        <p className={panels.reqEmptyResponse}>The stream carried nothing.</p>
      )}
    </>
  );
}

// One command — its collapsed row and, opened, the whole command line followed by each
// of its streams. Collapsed by default, every one of them, for the reason the program
// list's rows are: a command log is scanned by verdict and opened selectively.
function ShellEntry({
  entry,
  index,
}: {
  entry: ShellCommandEntry;
  index: number;
}) {
  const cwd = cwdLabel(entry.cwd);
  const ok = entry.exitCode === 0;
  return (
    <details className={panels.reqTurn}>
      <summary className={panels.reqTurnSummary}>
        <span className={panels.reqCaret} aria-hidden="true">
          ▸
        </span>
        <span className={panels.progPreview}>{entry.command}</span>
        {cwd != null && (
          <span className={panels.shellMeta} title={`Ran in ${cwd}`}>
            {cwd}
          </span>
        )}
        <span className={panels.shellMeta} title={ORIGIN_TITLES[entry.origin]}>
          {ORIGIN_LABELS[entry.origin]}
        </span>
        <span
          className={panels.progStatus}
          data-status={ok ? "success" : "other"}
        >
          exit {entry.exitCode}
        </span>
      </summary>
      <div className={panels.reqTurnBody}>
        <div className={panels.reqSectionLabel}>Command</div>
        <ExpandablePre
          content={entry.command}
          className={panels.reqContent}
          label={`Command ${index + 1}`}
        />
        <StreamSection
          caption={streamCaption("Stdout", entry.stdoutDropped)}
          content={entry.stdout}
          label={`Command ${index + 1} stdout`}
        />
        <StreamSection
          caption={streamCaption("Stderr", entry.stderrDropped)}
          content={entry.stderr}
          label={`Command ${index + 1} stderr`}
        />
      </div>
    </details>
  );
}

/**
 * The per-agent Shell view — every command line gg ran on this agent's behalf, in
 * order, each with its exit code as the verdict and its streams behind the row.
 */
export function ShellView({
  commands,
  live,
}: {
  commands: ShellCommandEntry[];
  live: boolean;
}) {
  if (commands.length === 0) {
    return (
      <p className={panels.empty}>
        {live ? "Waiting for the first command…" : "No commands were run."}
      </p>
    );
  }
  return (
    <div className={panels.requests}>
      {commands.map((entry, index) => (
        <ShellEntry key={index} entry={entry} index={index} />
      ))}
    </div>
  );
}
