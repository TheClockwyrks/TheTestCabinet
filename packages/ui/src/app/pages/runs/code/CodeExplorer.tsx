// The explorer: the part of the Code tab that turns ninety-odd scalars into something a
// judgement can be formed from.
//
// A summary tells you a tree's mean cyclomatic complexity is 4.1 and its size Gini is
// 0.62. Neither sentence tells you *what the model built* — which directory holds the
// work, which file is the god-file, which function is the one to open first. So this is a
// map and two tables over the same selection: drill into a directory and the map, the
// child table and the symbol table all narrow to it together.
//
// The map is the treemap primitive, so area encodes code lines on the same sequential
// ramp the memory map uses. The tables are the map's table-view twin: every figure the
// map encodes as area is also a number in a row, so nothing is reachable only by hovering
// a rectangle.
//
// When the run carried executed coverage, it is joined onto this same spine rather than
// listed again somewhere else — the coverage rows are repo-relative for exactly that
// reason, so they resolve against `CodeFileEntry.path` by string equality. A directory's
// figure is the sum of its files' covered and total counts (percentages do not average),
// and a file the reporter never measured shows an em dash, never a zero: `src/**/*.ts`
// is what was instrumented, so every asset, config and test file in the tree is
// legitimately unmeasured. The column is drawn only when a report was actually parsed;
// on every other run the table is exactly what it was.

import { useMemo, useState } from "react";
import { Treemap, type TreemapTile } from "@clockwyrks/ui";
import type { CoverageFile, ToolchainCoverage } from "@clockwyrks/run-record";
import type {
  CodeAnalysisDocument,
  CodeFileEntry,
} from "@clockwyrks/run-record/code-analysis";
import {
  buildCodeTree,
  codeBreadcrumb,
  findCodeNode,
  meanCyclomatic,
  symbolsUnder,
  type CodeTreeNode,
} from "./codeTree";
import { formatCodeBytes, formatCodeNumber } from "./codeFormat";
import {
  COVERAGE_METRIC_KEYS,
  COVERAGE_METRIC_META,
  coveragePercent,
  formatCoveragePercent,
  indexCoverage,
  rollUpCoverage,
} from "./coverageJoin";
import { CodeSymbolTable } from "./CodeSymbolTable";
import styles from "./CodePanels.module.scss";

/**
 * How many tiles the map draws before it folds the tail into one.
 *
 * A treemap of four hundred files is a texture, not a picture. The cap reports what it
 * hid — the fold is a labelled tile carrying the summed value, not a silent omission —
 * and the child table below is uncapped, so nothing is lost by it.
 */
const MAX_TILES = 36;

/**
 * The React key of the folded "everything else" tile.
 *
 * A leading `/` cannot collide with a real entry: the document's paths are relative to
 * the produced tree's root, so none of them starts with one. Which tile opens what is
 * decided by resolving the key against the node's children rather than by comparing it
 * to this constant, so the fold opens nothing even if that ever stopped being true.
 */
const REST_KEY = "/rest";

// What a tile's area means for the node being shown. Code lines is the honest encoding of
// "where did the work go", but a directory holding only JSON, Markdown and images has no
// code lines at all — and a map of nothing is less honest than a map of bytes that says
// it is a map of bytes.
function areaOf(node: CodeTreeNode): {
  value: (child: CodeTreeNode) => number;
  hint: string;
  format: (value: number) => string;
} {
  return node.codeLines > 0
    ? {
        value: (child) => child.codeLines,
        hint: "area = code lines",
        format: formatCodeNumber,
      }
    : {
        value: (child) => child.bytes,
        hint: "area = bytes",
        format: formatCodeBytes,
      };
}

function describe(
  child: CodeTreeNode,
  value: number,
  format: (value: number) => string,
): string {
  const kind = child.kind === "dir" ? "directory" : "file";
  const files =
    child.kind === "dir"
      ? `, ${formatCodeNumber(child.files)} ${child.files === 1 ? "file" : "files"}`
      : "";
  return `${child.name}: ${kind}, ${format(value)}${files}`;
}

export function CodeExplorer({
  document: analysis,
  coverage = null,
}: {
  document: CodeAnalysisDocument;
  /** The run's executed coverage, when its case wrote a summary. `null` on every run
   * that did not, which is the state the table renders exactly as it always did. */
  coverage?: ToolchainCoverage | null;
}) {
  const root = useMemo(() => buildCodeTree(analysis.files), [analysis.files]);
  const [path, setPath] = useState("");
  const covered = useMemo(() => indexCoverage(coverage), [coverage]);
  const measured = covered.size > 0;
  const node = findCodeNode(root, path);
  const trail = codeBreadcrumb(root, node.path);
  const symbols = useMemo(() => symbolsUnder(analysis, node), [analysis, node]);
  const file =
    node.kind === "file" && node.fileIndex !== undefined
      ? analysis.files[node.fileIndex]
      : undefined;

  const area = areaOf(node);
  // Biggest first, so the fold takes the tail rather than an arbitrary slice.
  const ranked = [...node.children].sort(
    (a, b) => area.value(b) - area.value(a),
  );
  const shown = ranked.slice(0, MAX_TILES);
  const folded = ranked.slice(MAX_TILES);
  const tiles: TreemapTile[] = shown.map((child) => ({
    key: child.path,
    label: child.name,
    value: area.value(child),
    detail: area.format(area.value(child)),
    description: describe(child, area.value(child), area.format),
    // A file the analyzer counted but never parsed is in a different state, not a
    // different series: it contributes size and nothing else, which is exactly what the
    // neutral dashed tile says.
    muted:
      child.kind === "file" &&
      child.fileIndex !== undefined &&
      !analysis.files[child.fileIndex]?.language,
    // A directory can be opened; the edge is what says so without spending the fill,
    // which is already carrying the magnitude.
    outlined: child.kind === "dir",
  }));
  if (folded.length > 0) {
    const rest = folded.reduce((sum, child) => sum + area.value(child), 0);
    if (rest > 0) {
      tiles.push({
        key: REST_KEY,
        label: `+${folded.length} more`,
        value: rest,
        detail: area.format(rest),
        description: `${folded.length} smaller entries, ${area.format(rest)} between them, listed in the table below`,
      });
    }
  }

  return (
    <section className={styles.explorer} aria-label="Code explorer">
      {/* One card: where you are, the map, and what is directly inside the node it
          shows. The symbol table below is the same selection asked a different
          question, so it is its own card rather than more rows in this one. */}
      <div className={styles.explorerMap}>
        <nav className={styles.breadcrumb} aria-label="Path">
          {trail.map((step, index) => (
            <span key={step.path || "/"} className={styles.crumb}>
              {index > 0 && <span className={styles.crumbSep}>/</span>}
              {index === trail.length - 1 ? (
                <span className={styles.crumbCurrent}>
                  {step.path === "" ? "Produced tree" : step.name}
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.crumbLink}
                  onClick={() => setPath(step.path)}
                >
                  {step.path === "" ? "Produced tree" : step.name}
                </button>
              )}
            </span>
          ))}
        </nav>

        {node.children.length > 0 ? (
          <Treemap
            tiles={tiles}
            ariaLabel={`Contents of ${node.path === "" ? "the produced tree" : node.path}, by ${area.hint.replace("area = ", "")}`}
            hint={area.hint}
            legend={[
              { kind: "ramp", label: "Parsed" },
              { kind: "muted", label: "Counted, not parsed" },
              { kind: "outlined", label: "Directory" },
            ]}
            onActivate={(tile) => {
              // Resolve the tile against the children rather than trusting its key to be
              // a path: the fold tile names no node, and so opens nothing.
              const target = node.children.find(
                (child) => child.path === tile.key,
              );
              if (target) setPath(target.path);
            }}
            readout={(tile) => (
              <>
                <strong>{tile.label}</strong> · {area.format(tile.value)} ·{" "}
                {Math.round(tile.share * 100)}% of this directory
              </>
            )}
          />
        ) : (
          file && <FileFacts file={file} coverage={covered.get(file.path)} />
        )}

        <table className={styles.table}>
          <caption className={styles.tableCaption}>
            {node.path === ""
              ? "Everything in the produced tree"
              : node.kind === "file"
                ? node.path
                : `Inside ${node.path}`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" className={styles.numeric}>
                Files
              </th>
              {/* The authorship counterpart of the coverage column: how many of those
                  files the analyzer classified as test files. Always available — it is a
                  static read — and until now aggregated per directory by `codeTree` and
                  rendered nowhere. */}
              <th
                scope="col"
                className={styles.numeric}
                title="Files the analyzer classified as test files"
              >
                Test files
              </th>
              <th scope="col" className={styles.numeric}>
                Code lines
              </th>
              <th scope="col" className={styles.numeric}>
                Share
              </th>
              <th scope="col" className={styles.numeric}>
                Functions
              </th>
              <th scope="col" className={styles.numeric}>
                Mean cyclo
              </th>
              <th scope="col" className={styles.numeric}>
                Imports
              </th>
              <th scope="col" className={styles.numeric}>
                Imported by
              </th>
              {measured && (
                <th
                  scope="col"
                  className={styles.numeric}
                  title="Executable lines the model's own tests reached, summed over this entry"
                >
                  Line cov
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {node.children.length === 0 && file && (
              <tr>
                <th scope="row">{node.name}</th>
                <td className={styles.numeric}>1</td>
                <td className={styles.numeric}>{file.isTest ? 1 : 0}</td>
                <td className={styles.numeric}>
                  {formatCodeNumber(file.codeLines)}
                </td>
                <td className={styles.numeric}>100%</td>
                <td className={styles.numeric}>
                  {formatCodeNumber(file.functions)}
                </td>
                <td className={styles.numeric}>
                  {file.functions > 0
                    ? (file.cyclomatic / file.functions).toFixed(1)
                    : "—"}
                </td>
                <td className={styles.numeric}>
                  {formatCodeNumber(file.fanOut)}
                </td>
                <td className={styles.numeric}>
                  {formatCodeNumber(file.fanIn)}
                </td>
                {measured && (
                  <td className={styles.numeric}>
                    {formatCoveragePercent(
                      coveragePercent(
                        covered.get(file.path)?.lines ?? {
                          covered: 0,
                          total: 0,
                        },
                      ),
                    )}
                  </td>
                )}
              </tr>
            )}
            {ranked.map((child) => {
              const entry =
                child.kind === "file" && child.fileIndex !== undefined
                  ? analysis.files[child.fileIndex]
                  : undefined;
              const mean = meanCyclomatic(child);
              const share =
                node.codeLines > 0 ? child.codeLines / node.codeLines : 0;
              // Summed over the subtree, so a directory's figure is its files' covered
              // lines over its files' total lines — not the mean of their percentages,
              // which would weight a ten-line helper like a four-hundred-line system.
              const rollup = measured
                ? rollUpCoverage(child.fileIndices, analysis.files, covered)
                : null;
              return (
                <tr key={child.path}>
                  <th scope="row">
                    <button
                      type="button"
                      className={styles.rowLink}
                      onClick={() => setPath(child.path)}
                      data-kind={child.kind}
                    >
                      {child.name}
                      {child.kind === "dir" ? "/" : ""}
                    </button>
                    {entry && !entry.language && (
                      <span
                        className={styles.tag}
                        title={
                          entry.sizeOnlyReason
                            ? `Counted for size only: ${entry.sizeOnlyReason}`
                            : "Counted for size only: no front end parses this language"
                        }
                      >
                        size only
                      </span>
                    )}
                    {entry?.isTest && <span className={styles.tag}>test</span>}
                  </th>
                  <td className={styles.numeric}>
                    {formatCodeNumber(child.files)}
                  </td>
                  <td className={styles.numeric}>
                    {formatCodeNumber(child.testFiles)}
                  </td>
                  <td className={styles.numeric}>
                    {formatCodeNumber(child.codeLines)}
                  </td>
                  <td className={styles.numeric}>{Math.round(share * 100)}%</td>
                  <td className={styles.numeric}>
                    {formatCodeNumber(child.functions)}
                  </td>
                  <td className={styles.numeric}>
                    {mean === null ? "—" : mean.toFixed(1)}
                  </td>
                  <td className={styles.numeric}>
                    {entry ? formatCodeNumber(entry.fanOut) : "—"}
                  </td>
                  <td className={styles.numeric}>
                    {entry ? formatCodeNumber(entry.fanIn) : "—"}
                  </td>
                  {measured && (
                    <td
                      className={styles.numeric}
                      title={
                        rollup
                          ? `${formatCodeNumber(rollup.measuredFiles)} of ${formatCodeNumber(child.files)} files measured`
                          : undefined
                      }
                    >
                      {formatCoveragePercent(
                        rollup ? coveragePercent(rollup.lines) : null,
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CodeSymbolTable
        symbols={symbols}
        files={analysis.files}
        scope={node.path === "" ? "the produced tree" : node.path}
      />
    </section>
  );
}

// The facts about one file that its row cannot carry: how big it is on disk, — the one
// that matters — why it was never parsed, when it was not, and what the model's own tests
// reached in it across all four istanbul metrics, when the run measured any. A file with
// no coverage row is simply absent from the measured set (`src/**/*.ts` is what was
// instrumented), which is a different fact from an untested one, so the entry is omitted
// rather than shown at zero.
function FileFacts({
  file,
  coverage,
}: {
  file: CodeFileEntry;
  coverage?: CoverageFile;
}) {
  return (
    <dl className={styles.fileFacts}>
      <div>
        <dt>On disk</dt>
        <dd>{formatCodeBytes(file.bytes)}</dd>
      </div>
      <div>
        <dt>Lines</dt>
        <dd>
          {formatCodeNumber(file.codeLines)} code ·{" "}
          {formatCodeNumber(file.commentLines)} comment ·{" "}
          {formatCodeNumber(file.blankLines)} blank
        </dd>
      </div>
      <div>
        <dt>Parsed as</dt>
        <dd>
          {file.language === "typeScript"
            ? "TypeScript"
            : file.language === "rust"
              ? "Rust"
              : `not parsed${file.sizeOnlyReason ? ` (${file.sizeOnlyReason})` : ""}`}
        </dd>
      </div>
      <div>
        <dt>Coupling</dt>
        <dd>
          imports {formatCodeNumber(file.fanOut)} · imported by{" "}
          {formatCodeNumber(file.fanIn)}
        </dd>
      </div>
      {coverage && (
        <div>
          <dt>Reached by the model&rsquo;s tests</dt>
          <dd>
            {COVERAGE_METRIC_KEYS.map((key, index) => (
              <span key={key}>
                {index > 0 && " · "}
                {COVERAGE_METRIC_META[key].label.toLowerCase()}{" "}
                {formatCoveragePercent(coveragePercent(coverage[key]))}
              </span>
            ))}
          </dd>
        </div>
      )}
    </dl>
  );
}
