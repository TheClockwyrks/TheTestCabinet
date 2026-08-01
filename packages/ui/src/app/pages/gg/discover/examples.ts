// The **example menu** — seven worked questions, straight from the design doc.
//
// This is not decoration, and it is not documentation either. A text language is strictly
// harder to *start* with than the widget builder it replaced: a builder shows you its
// whole vocabulary in its controls, while a text box shows you nothing. Autocomplete
// answers "what can follow this", the field sidebar answers "what is in the corpus", and
// these answer the question neither can — "what does a whole query look like?".
//
// They double as the language's regression surface: every one of them exercises a
// different part of the grammar (a glob, a negation, a boolean field, a distribution, a
// date histogram, an existence test), so a menu entry that stops parsing is a grammar
// break somebody notices immediately.
import type { GgInterval } from "@test-cabinet/run-record/gg-query";

/** One example: the question in English, and the query that asks it. */
export interface QueryExample {
  question: string;
  query: string;
}

/**
 * The examples, in the order the design doc lists them: three filters, then the
 * aggregations, then the two questions that only exist because the document model does
 * (`model` as a field of its own, and the code-analysis namespace M9 makes queryable).
 *
 * `interval` is the current range's histogram width, so the "sessions over time" example
 * buckets at whatever the operator's range is scoped to rather than at a hardcoded day.
 */
export function queryExamples(interval: GgInterval): QueryExample[] {
  return [
    {
      question: "Long recent sessions on one provider",
      query:
        'started >= now-30d and model:"anthropic/*" and metric.runTimeSeconds >= 1800',
    },
    {
      question: "Runs that were never offered the edit tool",
      query: "has.summary:true and not tool.editFile:*",
    },
    {
      question: "Everything that terminated abnormally",
      query: "state:(hung or timed_out or catastrophic)",
    },
    {
      question: "Abnormal-termination share, per configuration",
      query: "not state:completed | stats count() by preset",
    },
    {
      question: "Context overflow with compaction off, per model",
      query:
        "cap.compaction:false and has.summary:true | stats avg(summary.ranOutOfContext) as overflow_rate by model",
    },
    {
      question: "Score distribution, speculation on versus off",
      query: '| stats dist(score) by cap."speculative-execution"',
    },
    {
      question: "Sessions over time",
      query: `| stats count() by bucket(started, ${intervalText(interval)})`,
    },
  ];
}

/** An interval as the grammar spells it — `6h`, `1d`, `1w`. */
export function intervalText(interval: GgInterval): string {
  const unit =
    interval.unit === "minute"
      ? "m"
      : interval.unit === "hour"
        ? "h"
        : interval.unit === "day"
          ? "d"
          : "w";
  return `${Math.max(1, interval.count)}${unit}`;
}
