// The **document view** — the runs a query matched, one row each.
//
// A first-class surface, not a fallback behind the aggregate one. Most of what this
// replaces was used to *find sessions*: "which runs hung last week", "which ones never got
// the edit tool", "show me the three that cost more than a dollar". An aggregate answers
// how many; this answers which, and every row opens the run behind it.
//
// The columns are the fixed identity/outcome set **plus every field the query mentions**,
// because a filter is a statement about what the operator cares about. Asking for
// `metric.runTimeSeconds >= 1800` and getting a table with no run-time column is the
// oldest failure of a results grid.
import { Link } from "react-router";
import type { GgFilter, GgRunDoc, GgSortKey } from "@test-cabinet/run-record/gg-query";
import { routes } from "../../../routes";
import { ABSENT, formatFieldValue, rawValue } from "./cells";
import styles from "./GgDiscover.module.scss";

interface GgDocTableProps {
  documents: readonly GgRunDoc[];
  /** The compiled filter, whose fields become extra columns. */
  filter?: GgFilter;
  /** An explicit sort, whose fields become extra columns for the same reason. */
  sort?: readonly GgSortKey[];
  /**
   * Whether a row's id links to that run's detail page. Default `true` — the console,
   * where every recorded run has a page.
   *
   * `false` on the public site, where the corpus is deliberately **decoupled from
   * publication**: it holds every recorded gg run while the gallery holds only the
   * published ones, so most ids have no page to open. A table of links that mostly 404
   * is worse than a table of plain ids.
   */
  linkRuns?: boolean;
}

/**
 * The columns every document row shows, whatever the query.
 *
 * Identity, when, what, on what, how it ended, how it scored — the six a reader needs to
 * recognise a run. `id` leads because it is the link, and it is shortened in the cell:
 * a full run id is longer than the rest of the row put together.
 */
const CORE_COLUMNS: readonly string[] = [
  "id",
  "started",
  "case",
  "model",
  "state",
  "score",
];

export function GgDocTable({
  documents,
  filter,
  sort,
  linkRuns = true,
}: GgDocTableProps) {
  const columns = [...CORE_COLUMNS];
  for (const field of queryFields(filter, sort)) {
    if (!columns.includes(field)) columns.push(field);
  }

  if (documents.length === 0) {
    return <p className={styles.empty}>No run matches this query.</p>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const id = doc.fields.id;
            const runId = typeof id === "string" ? id : "";
            return (
              <tr key={runId || JSON.stringify(doc.fields)}>
                {columns.map((column) => {
                  const value = doc.fields[column];
                  if (column === "id") {
                    return (
                      <td key={column}>
                        {runId && linkRuns ? (
                          <Link to={routes.runDetail(runId)} title={runId}>
                            {shortId(runId)}
                          </Link>
                        ) : runId ? (
                          <span title={runId}>{shortId(runId)}</span>
                        ) : (
                          <span className={styles.absent}>{ABSENT}</span>
                        )}
                      </td>
                    );
                  }
                  // An **absent** field is dimmed and em-dashed, never printed as `0`.
                  // The document builder leaves a metric absent rather than zero on a run
                  // that produced nothing precisely so the longest runs are not the ones a
                  // long-run filter drops; a `0s` here would give that back in the view.
                  if (value === undefined) {
                    return (
                      <td key={column} className={styles.absent}>
                        {ABSENT}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={column}
                      className={typeof value === "number" ? styles.numCol : undefined}
                      title={rawValue(value)}
                    >
                      {formatFieldValue(column, value)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every field a compiled query names, in the order it names them.
 *
 * Walks the filter tree rather than the source text so it sees what actually ran —
 * a clause the operator was mid-way through typing compiles to nothing and correctly
 * contributes no column.
 */
export function queryFields(
  filter: GgFilter | undefined,
  sort: readonly GgSortKey[] | undefined,
): string[] {
  const found: string[] = [];
  const push = (field: string) => {
    if (!found.includes(field)) found.push(field);
  };
  const walk = (node: GgFilter) => {
    switch (node.kind) {
      case "and":
      case "or":
        node.clauses.forEach(walk);
        return;
      case "not":
        walk(node.clause);
        return;
      case "text":
        return;
      default:
        push(node.field);
    }
  };
  if (filter) walk(filter);
  for (const key of sort ?? []) push(key.field);
  return found;
}

/** A run id, shortened to its leading segment. Ids are long and share a prefix scheme; the
 *  full one is on the link's title and one click away. */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}
