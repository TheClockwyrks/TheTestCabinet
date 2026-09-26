import { Link } from "react-router";
import { Panel } from "@clockwyrks/ui";
import type { CoverageQueue } from "@clockwyrks/run-record/coverage";
import { claimSectionReturn } from "../../components/backReturn";
import { useTestCaseName } from "../../data/useTestCaseName";
import { formatTimeAgo } from "../../format";
import { routes } from "../../routes";
import { comboLabel } from "./comboLabels";
import { caseQualifier } from "./caseLabels";
import styles from "./Coverage.module.scss";

// The plan's own review queue: the completed runs of this plan the signed-in account
// has not reviewed, listed in the plan's emission order rather than newest-first like
// the global Unreviewed page. That order is the whole point — the buffer was filled
// deliberately so a cell's repeats arrive adjacent, and walking them in arrival order
// is what lets them be judged against each other.
//
// It is a panelled widget whose entries are whole rows: a queue is a worklist, and a
// worklist is read by scanning down a column of identical rows and pressing one. Each
// row is itself the link, so the press target is the row rather than a word inside it.
//
// Each row claims the coverage back-return before it navigates, so reviewing a run
// and pressing back lands here rather than on the runs index: open, review, back,
// repeat. `returnLabel` is what the run page's back control then calls this
// dashboard — the ladder reuses this component verbatim, and the two must not both
// announce themselves as the plan.
//
// `emptyMessage` decides what an empty queue renders. A surface that is nothing but
// this queue (the plan's Reviews tab) passes one and gets the widget with the message
// inside it; a surface that stacks the queue among others (the ladder board) passes
// none and the widget disappears rather than occupying a panel to say nothing.
export function CoverageReviewQueue({
  queue,
  returnLabel = "Back to the coverage plan",
  title = "Waiting on your review",
  emptyMessage,
}: {
  queue: CoverageQueue;
  returnLabel?: string;
  title?: string;
  emptyMessage?: string;
}) {
  const testCaseName = useTestCaseName();
  if (queue.runs.length === 0) {
    if (!emptyMessage) return null;
    return (
      <Panel className={styles.queuePanel}>
        <header className={styles.queueHead}>
          <h2 className={styles.queueTitle}>{title}</h2>
        </header>
        <p className={styles.queueEmpty}>{emptyMessage}</p>
      </Panel>
    );
  }
  return (
    <Panel className={styles.queuePanel}>
      <header className={styles.queueHead}>
        <h2 className={styles.queueTitle}>{title}</h2>
        <span className={styles.queueCount}>
          {queue.runs.length}
          {queue.truncated ? "+" : ""}
        </span>
      </header>
      <ol className={styles.queueList}>
        {queue.runs.map((entry) => (
          <li key={entry.runId}>
            <Link
              className={styles.queueRow}
              to={routes.runVerdict(entry.runId)}
              onClick={() => claimSectionReturn("coverage", returnLabel)}
            >
              <span className={styles.queueIdentity}>
                <span className={styles.queueName}>
                  {testCaseName(entry.slug)}
                </span>
                {/* The pin as the matrix spells it, engine included: a queue walked
                    in emission order puts one case's engines next to each other, and
                    two rows that read identically cannot be told apart before opening
                    them. */}
                <span className={styles.queueMeta}>{caseQualifier(entry)}</span>
                {/* Through the shared label, so a gg run reads the way its cell does.
                    A queue entry carries only the recorded launch identity, so a gg run
                    falls through to `gg · <model>` — the model its root agent ran. */}
                <span className={styles.queueMeta}>{comboLabel(entry)}</span>
              </span>
              <span className={styles.queueWhen}>
                {formatTimeAgo(entry.finishedAt)}
              </span>
              <span className={styles.queueGo} aria-hidden>
                Review ▸
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {queue.truncated && (
        <p className={styles.queueMore}>
          More are waiting behind these. The queue is walked from the front, not
          paged.
        </p>
      )}
    </Panel>
  );
}
