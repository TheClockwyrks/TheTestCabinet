// The model's own test suite, as the runner reported it.
//
// This is the one widget on the Code tab that describes something that RAN. Every other
// figure on the page is a static read of the source; these came out of
// `coverage/test-report.json`, which the case's build vitest config wrote when the
// toolchain stage executed the case's `test` command against the tree the model produced.
//
// The widget is the counts, the verdict, and — behind the verdict — the recorded tests
// themselves. A build that shipped no tests reports zeroes, a real result and one worth
// seeing, while a case that never wrote a report file at all renders no widget whatsoever,
// which is the gate in `codeFormat.ts` and not a decision made here.
//
// Nothing here is a score. A red suite is recorded and shown; it gates no rating, no
// verdict and no point, exactly as the toolchain contract says.

import { useState } from "react";
import { MetricTile } from "@clockwyrks/ui";
import type {
  ToolchainTest,
  ToolchainTests as ToolchainTestsRecord,
} from "@clockwyrks/run-record";
import { formatCodeNumber } from "./codeFormat";
import { ToolchainTestList, unmatchedFailures } from "./ToolchainTestList";
import styles from "./CodePanels.module.scss";

/** What the suite as a whole did, in a sentence, plus the tone that reinforces it.
 *
 * The tone never carries the meaning: each state spells out what happened, so the widget
 * reads identically with no color perception at all. The states are genuinely different
 * facts, and collapsing them would lose the three that are easiest to misread.
 *
 * **A green exit is not evidence that anything was checked.** The runner exits 0 for a
 * build that shipped no test at all, and equally for one whose every test is `it.skip`,
 * and `total` counts a declined test exactly like an evaluated one. So neither the exit
 * status nor `total` may reach the headline on its own: the passing states are keyed on
 * `passed`, which is the only counter that says an assertion was actually evaluated. This
 * is the contract the record itself states — `ToolchainTestFile::skipped` is counted apart
 * from `passed` so that "a suite that skipped half of itself cannot read as a suite that
 * passed all of itself" — and a headline that read `passed — ${total}` would discard it at
 * the last step.
 *
 * **A red invocation need not contain a failing test.** A test file that could not be
 * loaded fails the run while failing no assertion, so `0 failed` and `failed` appear
 * together and the widget has to explain that rather than look broken.
 *
 * Each note is one clause carrying the figures that state is about, and nothing else:
 * what the reader is looking at, never what the page decided to do about it. */
function verdictOf(tests: ToolchainTestsRecord): {
  tone: "ok" | "caution" | "degraded";
  headline: string;
  note: string;
} {
  const files = `${formatCodeNumber(tests.filesRun)} test ${tests.filesRun === 1 ? "file" : "files"}`;
  if (tests.succeeded && tests.total === 0) {
    return {
      tone: "caution",
      headline: "The suite ran no tests",
      note: `The runner exited 0 over ${files}.`,
    };
  }
  // Green, with tests declared, and not one of them evaluated. Vitest exits 0 on a suite
  // that is entirely `it.skip`/`it.todo`, so this is the shape a build reaches by writing
  // tests and then switching them off — the single most flattering thing a summary could
  // call "passed".
  if (tests.succeeded && tests.passed === 0) {
    return {
      tone: "caution",
      headline: `No test ran — ${formatCodeNumber(tests.skipped)} of ${formatCodeNumber(tests.total)} skipped`,
      note: "The runner exited 0 with no assertion evaluated.",
    };
  }
  // Green, but the suite is not the whole of what it declares. Stating both numbers is
  // what keeps the sentence true; the tone stays `ok` because tests did pass and no
  // threshold on "too many skips" would be anything but invented.
  if (tests.succeeded && tests.passed < tests.total) {
    return {
      tone: "ok",
      headline: `The suite passed — ${formatCodeNumber(tests.passed)} of ${formatCodeNumber(tests.total)} ${tests.total === 1 ? "test" : "tests"}`,
      note: `${formatCodeNumber(tests.skipped)} skipped, across ${files}.`,
    };
  }
  if (tests.succeeded) {
    return {
      tone: "ok",
      headline: `The suite passed — ${formatCodeNumber(tests.total)} ${tests.total === 1 ? "test" : "tests"}`,
      note: `Across ${files}.`,
    };
  }
  if (tests.failed === 0) {
    return {
      tone: "degraded",
      headline: "The run failed with no failing test",
      note:
        tests.filesFailed > 0
          ? `${formatCodeNumber(tests.filesFailed)} of ${files} failed to load.`
          : `The runner exited non-zero over ${files}.`,
    };
  }
  return {
    tone: "degraded",
    headline: `The suite failed — ${formatCodeNumber(tests.failed)} of ${formatCodeNumber(tests.total)} ${tests.total === 1 ? "test" : "tests"}`,
    note: `${formatCodeNumber(tests.filesFailed)} of ${files} carried a failure.`,
  };
}

/**
 * The per-test list the record carries, defensively.
 *
 * `tests` is required by the contract and by the generated type, and absent from every
 * run recorded before the contract widened — which is most of the stored corpus. A
 * legacy record must render as what it is (counts, and the failures it did record)
 * rather than crash or claim the suite ran nothing, so the array is read as untrusted
 * data rather than as the type promises.
 */
function recordedTests(tests: ToolchainTestsRecord): readonly ToolchainTest[] {
  const recorded: unknown = tests.tests;
  return Array.isArray(recorded) ? (recorded as ToolchainTest[]) : [];
}

export function ToolchainTests({ tests }: { tests: ToolchainTestsRecord }) {
  const verdict = verdictOf(tests);
  const recorded = recordedTests(tests);
  // A red suite is the reason anyone opens this, so it opens itself.
  const [open, setOpen] = useState(!tests.succeeded);
  // A record with no per-test list and tests in it predates the widened contract. Said
  // once, as a caveat, so the empty disclosure is not read as an empty suite.
  const legacy = recorded.length === 0 && tests.total > 0;
  // Every failure whose message the list cannot carry: the whole set on a legacy record,
  // and on a capped one the failures no recorded row matches.
  const orphanFailures =
    recorded.length === 0 ? tests.failures : unmatchedFailures(tests, recorded);
  // A file-level message is a file that failed to load and so ran no test at all. It is
  // the only account a red run with no failing test has of itself, and no per-test row
  // can carry it — the file contributed no rows.
  const unloadable = tests.files.filter(
    (file) => (file.message ?? "").length > 0,
  );

  return (
    <div className={styles.toolchain}>
      {/* The same tile row the page's own headline figures use, so the executed counts
          read as figures of the same standing as the static ones. */}
      <div className={styles.kpis}>
        <MetricTile label="Tests" value={formatCodeNumber(tests.total)} />
        <MetricTile label="Passed" value={formatCodeNumber(tests.passed)} />
        <MetricTile label="Failed" value={formatCodeNumber(tests.failed)} />
        <MetricTile label="Skipped" value={formatCodeNumber(tests.skipped)} />
        <MetricTile
          label="Test files"
          value={formatCodeNumber(tests.filesRun)}
        />
        <MetricTile
          label="Files with failures"
          value={formatCodeNumber(tests.filesFailed)}
        />
      </div>

      {/* The verdict, and the recorded tests behind it. The headline is the disclosure's
          summary rather than a line above one, so the card a reader already reads is the
          control that opens the detail. A record with no per-test list has nothing to
          disclose and stays the card it always was. */}
      <div className={styles.toolchainStatus} data-tone={verdict.tone}>
        {recorded.length > 0 ? (
          <>
            <button
              type="button"
              className={styles.statusToggle}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <span className={styles.twisty} aria-hidden="true">
                {open ? "▾" : "▸"}
              </span>
              <span className={styles.calloutTitle}>{verdict.headline}</span>
              <span className={styles.disclosureCount}>
                {formatCodeNumber(recorded.length)}
                {tests.testsTruncated
                  ? ` of ${formatCodeNumber(tests.total)}`
                  : ""}{" "}
                recorded
              </span>
            </button>
            <p className={styles.calloutNote}>{verdict.note}</p>
            {open && <ToolchainTestList tests={tests} recorded={recorded} />}
          </>
        ) : (
          <>
            <p className={styles.calloutTitle}>{verdict.headline}</p>
            <p className={styles.calloutNote}>{verdict.note}</p>
            {legacy && (
              <p className={styles.caveat}>
                Per-test detail was not recorded for this run.
              </p>
            )}
          </>
        )}
      </div>

      {unloadable.length > 0 && (
        <div className={styles.toolchainCard}>
          <h4 className={styles.figureHeading}>
            {formatCodeNumber(unloadable.length)} test{" "}
            {unloadable.length === 1 ? "file" : "files"} failed to load
          </h4>
          <ul className={styles.failureList}>
            {unloadable.map((file) => (
              <li key={file.path}>
                <p className={styles.failureName}>{file.path}</p>
                <pre className={styles.failureMessage}>{file.message}</pre>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The per-file cap, stated on its own condition rather than inside the card
          above. `files` is capped independently of `tests` and `failures`, and the only
          rows this widget draws from it are the files that failed to load — so a record
          whose file list was cut short while every file it kept loaded cleanly renders
          no card at all. Said only inside that card, the cap would go unreported in
          precisely the case where nothing else on the page implies it. */}
      {tests.filesTruncated && (
        <p className={`${styles.caveat} ${styles.bandCaveat}`}>
          The per-file list was capped at {formatCodeNumber(tests.files.length)}{" "}
          of {formatCodeNumber(tests.filesRun)} test files, so a file that
          failed to load may not be listed; the counts above cover the whole
          suite.
        </p>
      )}

      {orphanFailures.length > 0 && (
        <div className={styles.toolchainCard}>
          <h4 className={styles.figureHeading}>What failed</h4>
          <ul className={styles.failureList}>
            {orphanFailures.map((failure, index) => (
              <li key={`${failure.file}:${failure.name}:${index}`}>
                <p className={styles.failureName}>{failure.name}</p>
                <p className={styles.failureWhere}>{failure.file}</p>
                {failure.message && (
                  // Pre-formatted, because an assertion message is a diff and a diff
                  // that reflows is a diff you cannot read. Stack frames were stripped
                  // when the record was written, so what is here is the assertion.
                  <pre className={styles.failureMessage}>{failure.message}</pre>
                )}
              </li>
            ))}
          </ul>
          {/* The failure cap, on its own condition too. On a legacy record this card IS
              the failure list and the cap bounds what it shows; on a capped modern one
              the card shows the failures no recorded row matched, which is a subset of
              the same bounded array. Either way the card is partial and says so — the
              sentence differs only because the two cards are lists of different things,
              and the reader of a collapsed disclosure has nowhere else to learn it. */}
          {tests.failuresTruncated && (
            <p className={styles.caveat}>
              {recorded.length === 0
                ? `Showing the first ${formatCodeNumber(tests.failures.length)} of ${formatCodeNumber(tests.failed)} failures.`
                : `Detail was kept for the first ${formatCodeNumber(tests.failures.length)} of ${formatCodeNumber(tests.failed)} failures; the rest are counted above with none.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
