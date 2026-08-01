// The **completer** — what may follow the caret, ranked.
//
// This is not polish. A text language is strictly harder to start with than the widget
// builder it replaced, and without genuinely good autocomplete plus a field browser the
// redesign is a downgrade for the first five minutes of use. The two carry an extra load
// beyond discoverability: they are where a **sparse** field becomes visible. `tool.*` is
// deliberately sparse, so a suggestion that shows `tool.editFile — 12 documents` out of
// 400 tells an operator something an empty result never would.
//
// It works off the token stream rather than the tree, because the input is by definition
// half-typed: `cap.` is not a parseable predicate, but it is exactly the moment the
// operator wants the capability fields listed.
import type { GgFieldCatalog, GgFieldInfo } from "@test-cabinet/run-record/gg-query";
import { AGG_FUNCS, STAGE_KEYWORDS } from "./ast";
import { type Token, keywordOf, tokenize } from "./lex";
import { asDisplay } from "./values";
import { formatIdentifier, formatLiteral } from "./format";

/** What a suggestion is offering, so the editor can group and ice-badge them. */
export type CompletionKind = "field" | "value" | "keyword" | "function" | "interval";

/** One suggestion. */
export interface Completion {
  /** What the list shows. */
  label: string;
  /** What replaces {@link Completion.replace} when it is accepted. */
  insert: string;
  kind: CompletionKind;
  /** The document count behind a field or a value — the number that makes sparseness
   *  visible. Absent for a keyword or a function. */
  documents?: number;
  /** A short right-hand note: a field's kind, a keyword's role. */
  detail?: string;
  /** The span of source text the insertion replaces — the partial word under the caret,
   *  or a zero-width span at the caret when there is none. */
  replace: { start: number; end: number };
}

/** How many suggestions one request returns. Long enough to be useful, short enough that
 *  the list stays scannable on a corpus with thousands of `agent.*` fields. */
const MAX_COMPLETIONS = 30;

/**
 * Suggest completions for `text` at `caret`, against the corpus's field catalog.
 *
 * Context, in the order it is tested:
 *
 * | Where the caret is | What is offered |
 * | --- | --- |
 * | right after `\|` | the three stage keywords |
 * | in a `stats` aggregation list | the ten aggregation functions |
 * | inside `fn(` or after `by` | field names |
 * | after `bucket(field,` | histogram intervals |
 * | after a field's `:` or operator | that field's top values, **with counts** |
 * | anywhere else in the filter | field names, plus `not` |
 */
export function completeQuery(
  text: string,
  caret: number,
  catalog: GgFieldCatalog,
): Completion[] {
  const tokens = tokenize(text.slice(0, caret));
  // The `eof` token is never a completion context of its own; drop it and work from the
  // real tokens behind the caret.
  const real = tokens.filter((token) => token.kind !== "eof");

  // A word the caret is sitting inside (or at the end of) is the prefix being typed, and
  // the span the accepted suggestion replaces.
  const last = real[real.length - 1];
  const typing =
    last && last.end === caret && (last.kind === "word" || last.kind === "string")
      ? last
      : null;
  const prefix = typing ? (typing.kind === "string" ? typing.value : typing.text) : "";
  const replace = typing
    ? { start: typing.start, end: typing.end }
    : { start: caret, end: caret };
  const before = typing ? real.slice(0, -1) : real;
  const previous = before[before.length - 1];

  const fields = catalog.fields;

  // After a `|`, only a stage can follow.
  if (previous?.kind === "pipe") {
    return rank(
      STAGE_KEYWORDS.map((keyword) => ({
        label: keyword,
        insert: keyword,
        kind: "keyword" as const,
        detail: stageDetail(keyword),
        replace,
      })),
      prefix,
    );
  }

  const stage = enclosingStage(before);

  // `bucket(started, ` — the one place an interval belongs.
  if (stage === "stats" && awaitingInterval(before)) {
    return rank(
      ["15m", "1h", "6h", "1d", "1w"].map((interval) => ({
        label: interval,
        insert: interval,
        kind: "interval" as const,
        detail: "histogram bucket width",
        replace,
      })),
      prefix,
    );
  }

  if (stage === "stats") {
    if (inAggList(before)) {
      return rank(
        AGG_FUNCS.map((func) => ({
          label: `${func}()`,
          insert: func === "count" ? "count()" : `${func}(`,
          kind: "function" as const,
          detail: func === "count" ? "documents in the bucket" : "over a field",
          replace,
        })),
        prefix,
      );
    }
    // Inside `avg(` or after `by`: a field, and `bucket(` when a histogram is possible.
    const ranked = rank(fieldCompletions(fields, replace), prefix);
    if (!afterBy(before)) return ranked;
    // `bucket(` leads the `by` list rather than being ranked into it. A field name is
    // discoverable by typing the first letters of one; the only route to a date
    // histogram is a call nobody would guess, and ranking it by document count (it has
    // none) would bury it under every field in the corpus.
    const bucket = rank(
      [
        {
          label: "bucket(",
          insert: "bucket(",
          kind: "function" as const,
          detail: "date histogram",
          replace,
        },
      ],
      prefix,
    );
    return [...bucket, ...ranked].slice(0, MAX_COMPLETIONS);
  }

  if (stage === "sort" || stage === "limit") {
    if (stage === "limit") return [];
    return rank(fieldCompletions(fields, replace), prefix);
  }

  // In the filter. A value position is anything directly after a field's operator.
  const valueField = fieldAwaitingValue(before);
  if (valueField) {
    const info = fields.find((field) => field.name === valueField);
    if (info) return rank(valueCompletions(info, replace), prefix);
    return [];
  }

  const suggestions = fieldCompletions(fields, replace);
  suggestions.push({
    label: "not",
    insert: "not ",
    kind: "keyword",
    detail: "negate the next clause",
    replace,
  });
  return rank(suggestions, prefix);
}

/** One suggestion per catalog field, carrying the document count that makes a sparse
 *  field visible before the query is run rather than after it returns nothing. */
function fieldCompletions(
  fields: readonly GgFieldInfo[],
  replace: Completion["replace"],
): Completion[] {
  return fields.map((field) => ({
    label: field.name,
    insert: field.name.split(".").map(formatIdentifier).join("."),
    kind: "field" as const,
    documents: field.documents,
    detail: field.kind,
    replace,
  }));
}

/** A field's observed values, with their counts — the suggestions offered after a
 *  colon. */
function valueCompletions(
  field: GgFieldInfo,
  replace: Completion["replace"],
): Completion[] {
  return (field.topValues ?? []).map((entry) => {
    const rendered = asDisplay(entry.value);
    return {
      label: rendered,
      insert:
        typeof entry.value === "string"
          ? formatLiteral({ raw: rendered, quoted: false, span: replace })
          : rendered,
      kind: "value" as const,
      documents: entry.count,
      replace,
    };
  });
}

/**
 * Rank and cut: a prefix match first, then a substring match, then by document count
 * descending — and **otherwise the order it was given in**.
 *
 * Count-descending is the ranking that matters for fields. An operator typing `cap.`
 * wants the capabilities that runs actually configured, not the alphabetically first
 * one, and the same list doubles as a summary of what the corpus contains.
 *
 * There is deliberately **no alphabetical tiebreak**. The curated lists carry no document
 * counts and their declaration order is meaningful — `stats` before `sort` before
 * `limit`, `count()` before the folds that need a field, intervals ascending in width —
 * and sorting them by name would shuffle each into nonsense. The sort is stable, so
 * leaving the tie alone preserves the caller's order; for fields the caller's order is
 * the catalog's, which is already name-ascending.
 */
function rank(suggestions: Completion[], prefix: string): Completion[] {
  const needle = prefix.toLowerCase();
  const scored = suggestions
    .map((suggestion) => {
      const label = suggestion.label.toLowerCase();
      if (needle.length === 0) return { suggestion, score: 1 };
      if (label.startsWith(needle)) return { suggestion, score: 0 };
      if (label.includes(needle)) return { suggestion, score: 1 };
      return null;
    })
    .filter((entry): entry is { suggestion: Completion; score: number } => entry !== null);

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (b.suggestion.documents ?? 0) - (a.suggestion.documents ?? 0),
  );
  return scored.slice(0, MAX_COMPLETIONS).map((entry) => entry.suggestion);
}

/** Which stage the caret is in, or `null` for the filter. Found by walking back to the
 *  last `|`, which is cheaper and far more robust on half-typed text than re-parsing. */
function enclosingStage(before: readonly Token[]): "stats" | "sort" | "limit" | null {
  for (let i = before.length - 1; i >= 0; i -= 1) {
    if (before[i]!.kind === "pipe") {
      const head = before[i + 1];
      const keyword = head ? keywordOf(head) : null;
      return keyword === "stats" || keyword === "sort" || keyword === "limit"
        ? keyword
        : null;
    }
  }
  return null;
}

/** Whether the caret sits where an aggregation *name* belongs: right after `stats`, or
 *  after a comma that is not inside a `by` list. */
function inAggList(before: readonly Token[]): boolean {
  const last = before[before.length - 1];
  if (!last) return false;
  if (keywordOf(last) === "stats") return true;
  if (last.kind !== "comma") return false;
  return !afterBySomewhere(before);
}

/** Whether the caret is in the `by` list of the current stage. */
function afterBy(before: readonly Token[]): boolean {
  const last = before[before.length - 1];
  if (!last) return false;
  if (keywordOf(last) === "by") return true;
  return last.kind === "comma" && afterBySomewhere(before);
}

/** Whether a `by` has been seen since the last `|`. */
function afterBySomewhere(before: readonly Token[]): boolean {
  for (let i = before.length - 1; i >= 0; i -= 1) {
    if (before[i]!.kind === "pipe") return false;
    if (keywordOf(before[i]!) === "by") return true;
  }
  return false;
}

/** Whether the caret sits at the interval argument of `bucket(field, …)`. */
function awaitingInterval(before: readonly Token[]): boolean {
  const last = before[before.length - 1];
  if (last?.kind !== "comma") return false;
  // `bucket` `(` field `,` — three tokens back is the opening paren of a `bucket` call.
  const open = before[before.length - 3];
  const name = before[before.length - 4];
  if (!open || !name) return false;
  return open.kind === "lparen" && keywordOf(name) === "bucket";
}

/**
 * The field whose value the caret is about to type, or `null`.
 *
 * Walks back over the operator and then over the dotted field name, so `cap.compaction:`
 * and `model !=` both resolve. A one-of or a range is included: the caret after
 * `state:(` is still asking about `state`'s values.
 */
function fieldAwaitingValue(before: readonly Token[]): string | null {
  let i = before.length - 1;
  if (i < 0) return null;
  const at = (index: number): Token | null => before[index] ?? null;
  // Skip past a one-of/range opener and any values already listed.
  const head = at(i);
  if (head?.kind === "lparen" || head?.kind === "lbracket") i -= 1;
  else if (head && (keywordOf(head) === "or" || keywordOf(head) === "to")) {
    // Inside a `(a or …)` or `[a to …]`, walk back to the opener.
    while (i >= 0 && at(i)?.kind !== "lparen" && at(i)?.kind !== "lbracket") i -= 1;
    i -= 1;
  }
  if (i < 0) return null;
  const operator = at(i);
  if (operator?.kind !== "colon" && operator?.kind !== "op") return null;
  i -= 1;

  // The field name: one or more adjacent word/string tokens.
  const end = i;
  while (i >= 0) {
    const token = at(i);
    if (token?.kind !== "word" && token?.kind !== "string") break;
    const next = at(i + 1);
    if (i < end && next && token.end !== next.start) break;
    i -= 1;
  }
  const parts = before.slice(i + 1, end + 1);
  if (parts.length === 0) return null;
  return parts.map((token) => (token.kind === "string" ? token.value : token.text)).join("");
}

/** The one-line role of each stage keyword, shown beside it in the list. */
function stageDetail(keyword: (typeof STAGE_KEYWORDS)[number]): string {
  switch (keyword) {
    case "stats":
      return "aggregate the matching runs";
    case "sort":
      return "order the result";
    case "limit":
      return "cap the number of rows";
  }
}
