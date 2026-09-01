// The model's own test suite, as the runner reported it.
//
// This is the one widget on the Code tab that describes something that RAN. Every other
// figure on the page is a static read of the source; these came out of
// `coverage/test-report.json`, which the case's build vitest config wrote when the
// toolchain stage executed the case's `test` command against the tree the model produced.
//
// **Whose tests these are is the whole point, and the widget says it in words.** A run
// detail page also carries the test case's validator verdicts, and a reviewer sees both
// on the same run. The two have nothing to do with each other: the validators are The
// Test Cabinet's own graders, a separate vitest project (`validation/**`) run by a
// separate code path, and they contribute not one number here. What this reports is the
// suite the MODEL wrote, over the code the MODEL wrote. A build that shipped no tests
// reports zeroes — a real result, and one worth seeing — while a case that never wrote a
// report file at all renders no widget whatsoever, which is the gate in `codeFormat.ts`
// and not a decision made here.
//
// Nothing here is a score. A red suite is recorded and shown; it gates no rating, no
// verdict and no point, exactly as the toolchain contract says.

import { MetricTile } from "@test-cabinet/ui";
import type { ToolchainTests as ToolchainTestsRecord } from "@test-cabinet/run-record";
import { formatCodeNumber } from "./codeFormat";
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
 * together and the widget has to explain that rather than look broken. */
function verdictOf(tests: ToolchainTestsRecord): {
  tone: "ok" | "caution" | "degraded";
  headline: string;
  note: string;
} {
  if (tests.succeeded && tests.total === 0) {
    return {
      tone: "caution",
      headline: "The runner found no tests",
      note: "The build shipped none. This is a result the runner produced, not a missing measurement.",
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
      note: "The runner exited green because every test declined to run, not because an assertion held.",
    };
  }
  // Green, but the suite is not the whole of what it declares. Stating both numbers is
  // what keeps the sentence true; the tone stays `ok` because tests did pass and no
  // threshold on "too many skips" would be anything but invented.
  if (tests.succeeded && tests.passed < tests.total) {
    return {
      tone: "ok",
      headline: `The suite passed — ${formatCodeNumber(tests.passed)} of ${formatCodeNumber(tests.total)} ${tests.total === 1 ? "test" : "tests"}`,
      note: `${formatCodeNumber(tests.skipped)} skipped, across ${formatCodeNumber(tests.filesRun)} test ${tests.filesRun === 1 ? "file" : "files"} the model wrote.`,
    };
  }
  if (tests.succeeded) {
    return {
      tone: "ok",
      headline: `The suite passed — ${formatCodeNumber(tests.total)} ${tests.total === 1 ? "test" : "tests"}`,
      note: `Across ${formatCodeNumber(tests.filesRun)} test ${tests.filesRun === 1 ? "file" : "files"} the model wrote.`,
    };
  }
  if (tests.failed === 0) {
    return {
      tone: "degraded",
      headline: "The run failed with no failing test",
      note: "A test file the runner could not load fails the invocation without failing an assertion.",
    };
  }
  return {
    tone: "degraded",
    headline: `The suite failed — ${formatCodeNumber(tests.failed)} of ${formatCodeNumber(tests.total)} ${tests.total === 1 ? "test" : "tests"}`,
    note: `${formatCodeNumber(tests.filesFailed)} of ${formatCodeNumber(tests.filesRun)} test ${tests.filesRun === 1 ? "file" : "files"} carried a failure.`,
  };
}

export function ToolchainTests({ tests }: { tests: ToolchainTestsRecord }) {
  const verdict = verdictOf(tests);
  // The note column costs a third of the table's width, so it is only drawn when a file
  // actually failed to load — which is the only thing that puts a message there.
  const anyMessage = tests.files.some(
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

      <div className={styles.toolchainStatus} data-tone={verdict.tone}>
        <p className={styles.calloutTitle}>{verdict.headline}</p>
        <p className={styles.calloutNote}>{verdict.note}</p>
      </div>

      {tests.files.length > 0 && (
        <div className={styles.toolchainCard}>
          <table className={styles.table}>
            <caption className={styles.tableCaption}>
              Every test file the runner loaded
            </caption>
            <thead>
              <tr>
                <th scope="col">Test file</th>
                <th scope="col" className={styles.numeric}>
                  Passed
                </th>
                <th scope="col" className={styles.numeric}>
                  Failed
                </th>
                <th scope="col" className={styles.numeric}>
                  Skipped
                </th>
                {anyMessage && <th scope="col">Note</th>}
              </tr>
            </thead>
            <tbody>
              {tests.files.map((file) => (
                <tr key={file.path}>
                  <th scope="row">{file.path}</th>
                  <td className={styles.numeric}>
                    {formatCodeNumber(file.passed)}
                  </td>
                  <td className={styles.numeric}>
                    {formatCodeNumber(file.failed)}
                  </td>
                  <td className={styles.numeric}>
                    {formatCodeNumber(file.skipped)}
                  </td>
                  {anyMessage && (
                    <td className={styles.noteCell}>{file.message ?? "—"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {tests.filesTruncated && (
            <p className={styles.caveat}>
              The per-file list was capped; the counts above it are the whole
              suite&rsquo;s.
            </p>
          )}
        </div>
      )}

      {tests.failures.length > 0 && (
        <div className={styles.toolchainCard}>
          <h4 className={styles.figureHeading}>What failed</h4>
          <ul className={styles.failureList}>
            {tests.failures.map((failure, index) => (
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
          {tests.failuresTruncated && (
            <p className={styles.caveat}>
              Showing the first {formatCodeNumber(tests.failures.length)} of{" "}
              {formatCodeNumber(tests.failed)} failures.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
