import { useCallback } from "react";
import { Link, useSearchParams } from "react-router";
import { Pagination, Panel } from "@clockwyrks/ui";
import type { CoverageQueue } from "@clockwyrks/run-record/coverage";
import { useClientPage } from "../../components/useClientPage";
import { useTestCaseName } from "../../data/useTestCaseName";
import { formatTimeAgo } from "../../format";
import { routes } from "../../routes";
import { comboLabel } from "./comboLabels";
import { caseQualifier } from "./caseLabels";
import styles from "./Coverage.module.scss";

// The plan's own review queue: the completed runs of this plan the signed-in account
// has not reviewed, listed in the plan's emission order rather than newest-first like
// the global Unreviewed page. That order is the whole point — a plan launches a cell's
// repeats together, so they finish adjacent, and walking them in that order is what
// lets them be judged against each other. The queue is informational: reviews are
// optional labelling, and nothing a plan or a ladder does waits on them.
//
// It is a panelled widget whose entries are whole rows, read by scanning down a column
// of identical rows and pressing one. Each
// row is itself the link, so the press target is the row rather than a word inside it.
//
// A run opened from a row returns here when its back control is pressed, as every
// back control returns to the page it was reached from: open, review, back, repeat.
//
// `emptyMessage` decides what an empty queue renders. A surface that is nothing but
// this queue (the plan's Reviews tab) passes one and gets the widget with the message
// inside it; a surface that stacks the queue among others (the ladder board) passes
// none and the widget disappears rather than occupying a panel to say nothing.
//
// `intro` is a line under the heading saying what the queue is *for*: optional
// labelling after the fact, so a list of runs is never read as something the plan or
// the climb waits on.
//
// The queue is drawn a page at a time: a ladder of many models over many rungs leaves
// hundreds of runs to label, and the board under it should not sit a screen's length
// away. The page rides in the URL as its own key, beside the climber board's `page`,
// so reviewing a run and pressing back lands on the same page.

/** How many runs the queue draws per page. Matches the run listings. */
export const QUEUE_RUNS_PER_PAGE = 20;

/** The URL key the queue's page rides in, 1-based like `page`. */
export const QUEUE_PAGE_PARAM = "labelPage";

/** The queue's page as a 0-based index, read from and written to the URL. */
function useQueuePage() {
  const [params, setParams] = useSearchParams();
  const raw = Number.parseInt(params.get(QUEUE_PAGE_PARAM) ?? "", 10);
  const page = Number.isFinite(raw) && raw >= 1 ? raw - 1 : 0;
  const setPage = useCallback(
    (next: number, opts?: { replace?: boolean }) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next <= 0) p.delete(QUEUE_PAGE_PARAM);
          else p.set(QUEUE_PAGE_PARAM, String(next + 1));
          return p;
        },
        { replace: opts?.replace ?? false },
      );
    },
    [setParams],
  );
  return { page, setPage };
}

export function CoverageReviewQueue({
  queue,
  title = "Label runs (optional)",
  emptyMessage,
  intro,
}: {
  queue: CoverageQueue;
  title?: string;
  emptyMessage?: string;
  intro?: string;
}) {
  const testCaseName = useTestCaseName();
  const { page, setPage } = useQueuePage();
  const shown = useClientPage(queue.runs, QUEUE_RUNS_PER_PAGE, page, setPage);
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
      {intro && <p className={styles.queueIntro}>{intro}</p>}
      <ol className={styles.queueList}>
        {shown.items.map((entry) => (
          <li key={entry.runId}>
            <Link
              className={styles.queueRow}
              to={routes.runVerdict(entry.runId)}
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
      <Pagination
        page={shown.current}
        pageCount={shown.pageCount}
        onPageChange={setPage}
      />
      {queue.truncated && (
        <p className={styles.queueMore}>
          More are waiting behind these, and join the list as these are
          labelled.
        </p>
      )}
    </Panel>
  );
}
