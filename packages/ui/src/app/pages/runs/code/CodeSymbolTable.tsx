// Every function the analyzer scored, sortable.
//
// This is the table the whole code-analysis track exists to make possible. A mean
// cyclomatic complexity tells you a tree is fine; a named function with a cyclomatic
// complexity of 40, at a path and a line number, tells you where to go. So each row
// carries the location, and each column is a sort — because "the worst function" is a
// different question from "the longest", "the most deeply nested" and "the one with
// eleven parameters", and a table pinned to one order answers only the first.
//
// One column is different from the rest, and says so. Cross-file reference counting rests
// on a hand-rolled resolver in both languages — it handles re-export barrels, aliased
// re-exports, namespace member access and HTML entry points, and cannot see dynamic
// imports, computed member access or a reference that exists only in a bundler config.
// Those blind spots are worst exactly where this corpus lives. The header therefore
// carries the approximate marker, and it reads that marker from the **catalog** rather
// than asserting it here, so this header, the field sidebar, the chart axes and the docs
// page cannot disagree about which figures rest on approximation.

import { useState } from "react";
import type {
  CodeFileEntry,
  CodeSymbolEntry,
} from "@clockwyrks/run-record/code-analysis";
import {
  APPROXIMATE_MARK,
  APPROXIMATE_NOTE,
  formatCodeNumber,
  isApproximate,
} from "./codeFormat";
import styles from "./CodePanels.module.scss";

/**
 * How many rows the table draws.
 *
 * A tree of two hundred thousand functions is possible (it is one of the analyzer's own
 * caps), and drawing all of them would spend the page's whole budget on rows nobody
 * scrolls to. The cap says what it hid, and every column is a sort, so the rows worth
 * seeing are always reachable — which is the property that makes a cap honest rather than
 * a silent truncation.
 */
export const MAX_SYMBOL_ROWS = 150;

/**
 * The summary figure the per-symbol reference count shares its resolver with.
 *
 * The catalog describes the *summary*'s leaves, so there is no entry for a per-symbol
 * column. But the per-symbol count and `api.unreferencedExports` are the same
 * measurement, folded differently — so the column reads its honesty flag from the summary
 * metric it is derived from rather than hardcoding one. If the resolver ever becomes
 * exact, one edit to the analyzer's catalog clears the marker everywhere.
 */
const REFERENCE_METRIC = "api.unreferencedExports";

type SortKey =
  | "cyclomatic"
  | "cognitive"
  | "lines"
  | "maxNesting"
  | "parameters"
  | "exits"
  | "references";

interface Column {
  key: SortKey;
  label: string;
  /** The catalog path this column's honesty flag is read from, when it has one. */
  metric?: string;
}

const COLUMNS: Column[] = [
  { key: "lines", label: "Lines" },
  { key: "cyclomatic", label: "Cyclomatic" },
  { key: "cognitive", label: "Cognitive" },
  { key: "maxNesting", label: "Nesting" },
  { key: "parameters", label: "Params" },
  { key: "exits", label: "Exits" },
  { key: "references", label: "Refs", metric: REFERENCE_METRIC },
];

function valueOf(symbol: CodeSymbolEntry, key: SortKey): number | undefined {
  switch (key) {
    case "references":
      return symbol.references;
    default:
      return symbol[key];
  }
}

export function CodeSymbolTable({
  symbols,
  files,
  scope,
}: {
  symbols: readonly CodeSymbolEntry[];
  files: readonly CodeFileEntry[];
  /** What the rows are scoped to, named in the caption so a filtered table never reads as
   * the whole tree. */
  scope: string;
}) {
  const [sort, setSort] = useState<SortKey>("cyclomatic");
  const [ascending, setAscending] = useState(false);

  // The same card the table draws, reporting that there was nothing to put in it — a
  // widget with no rows still reads as the widget rather than vanishing into the
  // backdrop.
  if (symbols.length === 0) {
    return (
      <div className={styles.symbols}>
        <p className={styles.empty}>
          No functions were scored in {scope}. Nothing here was in a language
          the analyzer parses.
        </p>
      </div>
    );
  }

  // A total order, so the table is a pure function of the document: two functions equal
  // on the sorted column would otherwise swap places between renders. An absent value (a
  // non-exported function has no cross-file reference count at all) sorts last in either
  // direction, because "not measured" is not "zero".
  const ordered = [...symbols].sort((a, b) => {
    const left = valueOf(a, sort);
    const right = valueOf(b, sort);
    if (left === undefined && right === undefined) return a.file - b.file;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    const primary = ascending ? left - right : right - left;
    return primary || a.file - b.file || a.line - b.line;
  });
  const shown = ordered.slice(0, MAX_SYMBOL_ROWS);
  const hidden = ordered.length - shown.length;
  const approximate = isApproximate(REFERENCE_METRIC);

  return (
    <div className={styles.symbols}>
      <table className={styles.table}>
        <caption className={styles.tableCaption}>
          {formatCodeNumber(symbols.length)}{" "}
          {symbols.length === 1 ? "function" : "functions"} in {scope}
          {hidden > 0 && `, showing the first ${MAX_SYMBOL_ROWS}`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Function</th>
            {COLUMNS.map((column) => {
              const marked = column.metric && isApproximate(column.metric);
              const active = sort === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={styles.numeric}
                  aria-sort={
                    active ? (ascending ? "ascending" : "descending") : "none"
                  }
                >
                  <button
                    type="button"
                    className={styles.sortButton}
                    data-active={active ? "" : undefined}
                    title={marked ? APPROXIMATE_NOTE : undefined}
                    onClick={() => {
                      if (active) setAscending((v) => !v);
                      else {
                        setSort(column.key);
                        setAscending(false);
                      }
                    }}
                  >
                    {column.label}
                    {marked && (
                      <span className={styles.approxMark}>
                        {APPROXIMATE_MARK}
                      </span>
                    )}
                    {active && (
                      <span aria-hidden="true">{ascending ? " ▲" : " ▼"}</span>
                    )}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((symbol) => {
            const file = files[symbol.file];
            return (
              <tr key={`${symbol.file}:${symbol.line}:${symbol.name}`}>
                <th scope="row">
                  <span className={styles.symbolName}>{symbol.name}</span>
                  {symbol.exported && (
                    <span className={styles.tag}>exported</span>
                  )}
                  <span className={styles.symbolWhere}>
                    {file ? file.path : "?"}:{symbol.line}
                  </span>
                </th>
                <td className={styles.numeric}>
                  {formatCodeNumber(symbol.lines)}
                </td>
                <td className={styles.numeric}>
                  {formatCodeNumber(symbol.cyclomatic)}
                </td>
                <td className={styles.numeric}>
                  {formatCodeNumber(symbol.cognitive)}
                </td>
                <td className={styles.numeric}>
                  {formatCodeNumber(symbol.maxNesting)}
                </td>
                <td className={styles.numeric}>
                  {formatCodeNumber(symbol.parameters)}
                </td>
                <td className={styles.numeric}>
                  {formatCodeNumber(symbol.exits)}
                </td>
                {/* Absent, not zero: a non-exported function's references are not
                    attributed across files at all, and rendering that as 0 would say the
                    analyzer looked and found none. */}
                <td className={styles.numeric}>
                  {symbol.references === undefined
                    ? "—"
                    : formatCodeNumber(symbol.references)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {approximate && <p className={styles.caveat}>{APPROXIMATE_NOTE}</p>}
    </div>
  );
}
