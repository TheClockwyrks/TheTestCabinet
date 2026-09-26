// One **panel** of a dashboard: a heading, whatever the result shape admits, and the
// numbers behind it.
//
// It renders through exactly the components Discover renders through —
// `chooseVisualizations` via `GgVizPanel`, `GgBucketTable`, `GgDocTable` — because a
// panel is a query result and there is only one honest way to draw one. Nothing here
// picks a chart type, mints a color, or formats a number; a second implementation of any
// of those is a second set of published figures.
//
// Three properties the panel is responsible for on its own:
//
// - **A table-view twin, in place.** The chart is a disclosure away from the numbers it
//   drew, so no value is reachable only through a picture. Discover satisfies the same
//   obligation by putting the table under the chart; a board cannot afford the height, so
//   it collapses it instead of dropping it.
// - **A panel that failed to parse says so.** A board is read at a glance, and an empty
//   card is indistinguishable from an empty result — which is the difference between "no
//   sessions matched" and "this panel's field was renamed six months ago".
// - **The heading links into Discover** carrying the panel's own text and the board's
//   range, so "why is that number that" is one click from the editor, the field sidebar
//   and the completer.
import { Link } from "react-router";
import { Spinner } from "@clockwyrks/ui";
import type { GgQueryResponse } from "@clockwyrks/run-record/gg-query";
import { GgBucketTable } from "../discover/GgBucketTable";
import { GgDocTable } from "../discover/GgDocTable";
import { GgVizPanel } from "../discover/GgVizPanel";
import { routes } from "../../../routes";
import type { CompiledPanel } from "./dashboardQueries";
import styles from "./GgDashboards.module.scss";

interface GgDashboardPanelProps {
  /** The panel and the query it compiled to. */
  compiled: CompiledPanel;
  /** The panel's answer, or `undefined` while the board's first batch is in flight. */
  result?: GgQueryResponse;
  /** The board's range token, carried into the Discover link so the question opens
   *  over the window it was answered in. */
  rangeId: string;
}

export function GgDashboardPanel({
  compiled,
  result,
  rangeId,
}: GgDashboardPanelProps) {
  const { panel, query, groupBy, errors } = compiled;
  // Read off the *response*, not the query: an aggregated result is the one that came
  // back with columns, and a panel whose `stats` stage is malformed compiles without one.
  const aggregated = (result?.columns?.length ?? 0) > 0;

  return (
    <section
      className={styles.panel}
      style={{ gridColumn: `span ${Math.min(Math.max(panel.width, 1), 12)}` }}
    >
      <div className={styles.panelHead}>
        <h3 className={styles.panelTitle}>{panel.title}</h3>
        <Link
          className={styles.panelLink}
          to={routes.ggAnalysisDiscover(panel.query, { range: rangeId })}
        >
          Open in Discover
        </Link>
      </div>

      {errors.length > 0 ? (
        // Named rather than swallowed: a card that silently renders nothing is
        // indistinguishable from one whose query legitimately matched nothing.
        <p className={`${styles.panelMeta} ${styles.panelError}`}>
          {errors.join(" · ")}
        </p>
      ) : !result ? (
        <Spinner variant="flap" label="Loading…" />
      ) : (
        <>
          <p className={styles.panelMeta}>
            <strong>{result.totalRuns.toLocaleString("en-US")}</strong>{" "}
            {result.totalRuns === 1 ? "run" : "runs"}
            {result.truncated && " · showing the first rows only"}
          </p>

          {aggregated ? (
            <>
              <GgVizPanel
                buckets={result.buckets ?? []}
                columns={result.columns ?? []}
                groupBy={groupBy}
              />
              <details className={styles.panelTable}>
                <summary>Table</summary>
                <GgBucketTable
                  buckets={result.buckets ?? []}
                  columns={result.columns ?? []}
                  groupBy={groupBy}
                />
              </details>
            </>
          ) : (
            <GgDocTable
              documents={result.documents ?? []}
              filter={query.filter}
              sort={query.sort}
            />
          )}
        </>
      )}

      <p className={styles.panelQuery}>{panel.query || "(every session)"}</p>
    </section>
  );
}
