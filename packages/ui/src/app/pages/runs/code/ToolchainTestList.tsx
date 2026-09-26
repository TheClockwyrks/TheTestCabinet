// The individual tests the runner reported, as the disclosure body under the verdict.
//
// The counts above this list say how many tests there were; this says WHICH they were —
// the name the model gave each one, what the runner decided about it, how long it took,
// and the file it came from. It is the recorded report, not a re-derivation: nothing here
// is computed from anything but `tests.tests`, and the rows stay in the runner's own
// order (file by file as reported, run order within a file) rather than the path sort the
// per-file rows used, so the list reads as the suite ran.
//
// Two things make it survive a thousand rows. The list virtualizes past
// `VIRTUALIZE_ABOVE`, so a capped 1,000-entry report puts a screenful of rows in the DOM
// rather than all of them; and the failure filter is a first-class control, because a
// reader who opens this on a red suite came for the two rows that failed.

import { useMemo, useState } from "react";
import { SegmentedControl, StatusGlyph } from "@clockwyrks/ui";
import type {
  ToolchainTest,
  ToolchainTestStatus,
  ToolchainTests as ToolchainTestsRecord,
} from "@clockwyrks/run-record";
import { VirtualFeed } from "../../../components/VirtualFeed";
import { formatCodeNumber, formatTestDuration } from "./codeFormat";
import styles from "./CodePanels.module.scss";

/** Above this many rows the list virtualizes instead of rendering every row.
 *
 * Under it, a plain list is the better widget: it grows to its content, so a suite of
 * forty tests is read by scrolling the page rather than a box inside it. Over it, the
 * DOM cost is what matters — the record caps the entries at 1,000, and 1,000 rows each
 * carrying a glyph, a name, a path and a duration is a page that stutters when it opens.
 */
export const VIRTUALIZE_ABOVE = 120;

/** The row filter. `all` is the recorded list; the rest are one recorded status. */
type StatusFilter = "all" | ToolchainTestStatus;

const STATUS_LABEL: Record<ToolchainTestStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
};

/** A test's status as the shared glyph. `skipped` is not a failure and is not drawn as
 * one — it takes the same neutral mark the rest of the console gives an outcome that was
 * never decided. */
function glyphOf(status: ToolchainTestStatus): "pass" | "fail" | "none" {
  return status === "passed" ? "pass" : status === "failed" ? "fail" : "none";
}

/** Key a failure by the pair that identifies a test in the report. */
function failureKey(file: string, name: string): string {
  return `${file}\0${name}`;
}

/**
 * The recorded failure messages, by test.
 *
 * `failures` carries up to ten failures with their assertion messages, and `tests`
 * carries every test with no message at all, so the message is joined onto the row it
 * belongs to. The first entry wins: two tests in one file may share a name, and the
 * report lists them in the order they failed.
 */
export function failureMessages(
  tests: ToolchainTestsRecord,
): Map<string, string> {
  const messages = new Map<string, string>();
  for (const failure of tests.failures) {
    if (!failure.message) continue;
    const key = failureKey(failure.file, failure.name);
    if (!messages.has(key)) messages.set(key, failure.message);
  }
  return messages;
}

/**
 * The failures whose message the list cannot show.
 *
 * A record whose per-test list was capped can carry a failure that no recorded row
 * matches, and dropping its message would lose the one detail a reader opened this for.
 * Those failures keep their own card.
 */
export function unmatchedFailures(
  tests: ToolchainTestsRecord,
  recorded: readonly ToolchainTest[],
): ToolchainTestsRecord["failures"] {
  if (tests.failures.length === 0) return [];
  const present = new Set(
    recorded.map((test) => failureKey(test.file, test.name)),
  );
  return tests.failures.filter(
    (failure) => !present.has(failureKey(failure.file, failure.name)),
  );
}

export function ToolchainTestList({
  tests,
  recorded,
}: {
  tests: ToolchainTestsRecord;
  recorded: readonly ToolchainTest[];
}) {
  const counts = useMemo(() => {
    const tally: Record<ToolchainTestStatus, number> = {
      passed: 0,
      failed: 0,
      skipped: 0,
    };
    for (const test of recorded) tally[test.status] += 1;
    return tally;
  }, [recorded]);

  // The reason anyone opens this on a red suite is the failing rows, so the filter opens
  // on them when there are any.
  const [filter, setFilter] = useState<StatusFilter>(
    counts.failed > 0 ? "failed" : "all",
  );

  const messages = useMemo(() => failureMessages(tests), [tests]);
  const rows = useMemo(
    () =>
      filter === "all"
        ? recorded
        : recorded.filter((test) => test.status === filter),
    [recorded, filter],
  );

  const options = [
    {
      value: "all" as const,
      label: `All ${formatCodeNumber(recorded.length)}`,
    },
    ...(["failed", "passed", "skipped"] as const)
      .filter((status) => counts[status] > 0)
      .map((status) => ({
        value: status,
        label: `${STATUS_LABEL[status]} ${formatCodeNumber(counts[status])}`,
      })),
  ];

  const renderRow = (index: number) => {
    const test = rows[index];
    if (!test) return null;
    return (
      <TestRow
        test={test}
        message={messages.get(failureKey(test.file, test.name))}
      />
    );
  };

  return (
    <div className={styles.testList}>
      {options.length > 2 && (
        <SegmentedControl
          options={options}
          value={filter}
          onChange={setFilter}
          ariaLabel="Filter the recorded tests by status"
        />
      )}

      {rows.length > VIRTUALIZE_ABOVE ? (
        <VirtualFeed
          className={styles.testScroller}
          count={rows.length}
          itemContent={renderRow}
          computeKey={(index) => {
            const test = rows[index];
            return test ? `${test.file}\0${test.name}\0${index}` : index;
          }}
          role="list"
        />
      ) : (
        <div className={styles.testRows} role="list">
          {rows.map((test, index) => (
            <TestRow
              key={`${test.file}\0${test.name}\0${index}`}
              test={test}
              message={messages.get(failureKey(test.file, test.name))}
            />
          ))}
        </div>
      )}

      {tests.testsTruncated && (
        <p className={styles.caveat}>
          List capped at {formatCodeNumber(recorded.length)} of{" "}
          {formatCodeNumber(tests.total)} tests; the counts above cover the
          whole suite.
        </p>
      )}
      {tests.failuresTruncated && (
        <p className={styles.caveat}>
          Messages recorded for the first{" "}
          {formatCodeNumber(tests.failures.length)} of{" "}
          {formatCodeNumber(tests.failed)} failures.
        </p>
      )}
    </div>
  );
}

/** One recorded test: what the runner decided, what the model called it, how long it
 * took, and where it lives. A failing row carries its assertion message when the record
 * kept one. */
function TestRow({ test, message }: { test: ToolchainTest; message?: string }) {
  const duration = formatTestDuration(test.durationMs);
  return (
    <div className={styles.testRow} role="listitem" data-status={test.status}>
      <StatusGlyph
        status={glyphOf(test.status)}
        label={STATUS_LABEL[test.status]}
      />
      <div className={styles.testMain}>
        <span className={styles.testName}>{test.name}</span>
        <span className={styles.testFile}>{test.file}</span>
        {message && (
          // Pre-formatted: an assertion message is a diff, and a diff that reflows is a
          // diff you cannot read. Stack frames were stripped when the record was written.
          <pre className={styles.failureMessage}>{message}</pre>
        )}
      </div>
      {/* An absent duration is NOT TIMED, never zero — the ordinary case for a test that
          never ran — so it takes the page's em dash for an unmeasured figure, with the
          word itself as the accessible name and the hover title. */}
      {duration === null ? (
        <span
          className={styles.testDuration}
          role="img"
          aria-label="Not timed"
          title="Not timed"
        >
          &mdash;
        </span>
      ) : (
        <span className={styles.testDuration}>{duration}</span>
      )}
    </div>
  );
}
