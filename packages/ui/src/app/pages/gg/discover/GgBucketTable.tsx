// The **bucket view** — one row per group, one column per requested aggregation.
//
// Two rendering rules carry the design's honesty guarantees, and neither is cosmetic:
//
// - **`contributing` is shown whenever it is below the bucket's `n`.** It is the
//   denominator. TCQ has no `rate()` function because averaging a boolean *is* a rate —
//   and the thing that makes that safe is that a view always says how many of the bucket's
//   documents actually carried the field. An average over a sparse field with the
//   denominator hidden is a number that looks like a measurement and is not one.
// - **An absent figure is an em dash, never a zero.** A whole column can be absent in a
//   bucket whose documents exist; printing `0` there would put a fabricated point in the
//   middle of every comparison.
//
// The table is always reachable, whatever the visualization above it shows, because a
// chart drops what it cannot draw and the numbers behind it are the record.
import type {
  GgAggColumn,
  GgBucket,
  GgGroupKey,
} from "@clockwyrks/run-record/gg-query";
import { formatNumber } from "../query";
import { ABSENT, formatAggValue, formatBucketKey } from "./cells";
import styles from "./GgDiscover.module.scss";

interface GgBucketTableProps {
  buckets: readonly GgBucket[];
  columns: readonly GgAggColumn[];
  /** The stage's group keys, in stage order — what tells a date-histogram key from an
   *  ordinary numeric one, since both are just numbers by the time they reach here. */
  groupBy?: readonly GgGroupKey[];
}

export function GgBucketTable({
  buckets,
  columns,
  groupBy,
}: GgBucketTableProps) {
  if (buckets.length === 0) {
    return <p className={styles.empty}>No run matches this query.</p>;
  }

  // The grand-total bucket of an ungrouped `stats` has an empty key; it still gets a
  // leading column, labelled for what it is rather than left blank.
  const keyFields = buckets[0]!.key.map((part) => part.field);

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {keyFields.length === 0 ? (
              <th scope="col">all runs</th>
            ) : (
              keyFields.map((field) => (
                <th key={field} scope="col">
                  {field}
                </th>
              ))
            )}
            <th
              scope="col"
              className={styles.numCol}
              title="Documents in the bucket"
            >
              n
            </th>
            {columns.map((column) => (
              <th key={column.name} scope="col" className={styles.numCol}>
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucketKey(bucket)}>
              {bucket.key.length === 0 ? (
                <td>all runs</td>
              ) : (
                bucket.key.map((part, index) => (
                  <td
                    key={part.field}
                    className={
                      part.value === undefined ? styles.absent : undefined
                    }
                  >
                    {formatBucketKey(
                      part.field,
                      part.value,
                      isHistogram(groupBy, index),
                    )}
                  </td>
                ))
              )}
              <td className={styles.numCol}>{formatNumber(bucket.n)}</td>
              {columns.map((column) => {
                const value = bucket.values.find(
                  (entry) => entry.name === column.name,
                );
                if (!value) {
                  return (
                    <td
                      key={column.name}
                      className={`${styles.numCol} ${styles.absent}`}
                    >
                      {ABSENT}
                    </td>
                  );
                }
                return (
                  <td key={column.name} className={styles.numCol}>
                    {value.distribution ? (
                      <span title="min · q1 · median · q3 · max">
                        {distributionText(value.distribution)}
                      </span>
                    ) : value.value === undefined ? (
                      <span className={styles.absent}>{ABSENT}</span>
                    ) : (
                      formatAggValue(column.func, column.field, value.value)
                    )}
                    {/* The denominator, shown exactly when it is not the whole bucket. */}
                    {value.contributing < bucket.n && (
                      <span
                        className={styles.contrib}
                        title={`${value.contributing} of ${bucket.n} runs carried this field`}
                      >
                        {" "}
                        ({value.contributing}/{bucket.n})
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A distribution as one cell: the five-number summary, median emphasised by position.
 *  No confidence interval — TCQ's `dist()` deliberately carries none, because reproducing
 *  a seeded bootstrap bit-for-bit across two implementations is the most drift-prone thing
 *  that could enter a mirrored evaluator, for a decoration. */
function distributionText(dist: {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}): string {
  return [dist.min, dist.q1, dist.median, dist.q3, dist.max]
    .map((n) => formatNumber(Math.round(n * 1000) / 1000))
    .join(" · ");
}

/** Whether the group key at this position is a date histogram, so its key renders as a
 *  timestamp rather than as the raw epoch milliseconds it is. */
function isHistogram(
  groupBy: readonly GgGroupKey[] | undefined,
  index: number,
): boolean {
  return groupBy?.[index]?.kind === "bucket";
}

/** A stable React key for a bucket: its composite key, which is unique by construction. */
function bucketKey(bucket: GgBucket): string {
  return (
    bucket.key.map((part) => `${part.field}=${String(part.value)}`).join("|") ||
    "all"
  );
}
