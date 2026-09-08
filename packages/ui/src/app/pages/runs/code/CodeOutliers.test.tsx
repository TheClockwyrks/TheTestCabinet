// The two rankings, rendered.
//
// Every assertion here is read off the drawn figure rather than off the arrays behind
// it, because all three properties this component claims are properties of the *chart*:
//
// - **Two bars never share a label.** A bar chart's categories are its band domain, so a
//   repeated function name — `update`, `draw`, `reset`, which model-written trees carry
//   by the dozen — would merge two bars into one and misstate both values. The merge is
//   silent and looks like a shorter ranking, so nothing but counting the drawn rows
//   catches it.
// - **The order is worst-first**, including the tie-break, so this ranking names the same
//   worst function the symbol table and the CLI report do.
// - **Zero-line files are dropped before the cap**, not after, so the file ranking is
//   TOP_N long whatever proportion of the tree was empty.
//
// Reading the y-axis ticks is what makes those assertions unfakeable: a component that
// built the right array and handed it to a chart that alphabetized it, or merged it,
// would satisfy any assertion made against the array and fail these.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  CodeAnalysisDocument,
  CodeFileEntry,
  CodeSymbolEntry,
} from "@clockwyrks/run-record/code-analysis";
import { CodeOutliers } from "./CodeOutliers";

function file(path: string, codeLines: number): CodeFileEntry {
  return {
    path,
    language: "typeScript",
    bytes: codeLines * 30,
    codeLines,
    commentLines: 0,
    blankLines: 0,
    functions: 1,
    cyclomatic: 1,
    cognitive: 1,
    fanOut: 0,
    fanIn: 0,
    isTest: false,
  };
}

function symbol(over: Partial<CodeSymbolEntry> = {}): CodeSymbolEntry {
  return {
    file: 0,
    name: "f",
    line: 1,
    lines: 10,
    cyclomatic: 1,
    cognitive: 1,
    maxNesting: 1,
    parameters: 1,
    exits: 1,
    exported: false,
    ...over,
  };
}

function document(
  over: Partial<CodeAnalysisDocument> = {},
): CodeAnalysisDocument {
  return {
    analyzerVersion: 1,
    summary: {} as CodeAnalysisDocument["summary"],
    files: [file("src/game.ts", 100), file("src/ui/hud.ts", 50)],
    symbols: [],
    imports: [],
    cycles: [],
    clones: [],
    ...over,
  };
}

/**
 * The category labels of the `nth` figure, in the order the band scale draws them.
 *
 * Plot emits the ordinal axis's ticks in domain order, and the domain is the order the
 * component pinned — so this is the drawn ranking, not the data behind it.
 */
function bandLabels(container: HTMLElement, nth: number): string[] {
  const figure = container.querySelectorAll("figure")[nth];
  const axis = figure?.querySelector('[aria-label="y-axis tick label"]');
  return [...(axis?.querySelectorAll("text") ?? [])].map(
    (text) => text.textContent ?? "",
  );
}

describe("CodeOutliers", () => {
  it("qualifies a repeated function name and leaves a unique one bare", () => {
    // Two functions called `update` in different files. Unqualified they are one band
    // key, so the chart would draw a single `update` bar and quietly lose the other.
    const { container } = render(
      <CodeOutliers
        document={document({
          symbols: [
            symbol({ name: "update", file: 0, line: 12, cyclomatic: 30 }),
            symbol({ name: "update", file: 1, line: 40, cyclomatic: 20 }),
            symbol({
              name: "resolveCollision",
              file: 0,
              line: 90,
              cyclomatic: 25,
            }),
          ],
        })}
      />,
    );
    expect(bandLabels(container, 0)).toEqual([
      "update · game.ts:12",
      "resolveCollision",
      "update · hud.ts:40",
    ]);
  });

  it("ranks worst first, and breaks a tie by file then line", () => {
    // Three of the four score 7 cyclomatic; cognitive separates one of them, and the
    // last two tie on both measures and are separated by position.
    //
    // The tied pair is supplied *out* of file-then-line order deliberately. `sort` is
    // stable, so a comparator that returned 0 on the tie would reproduce whatever order
    // it was handed — which is why an in-order input cannot tell the documented total
    // order from no tie-break at all. It matters because the three surfaces that claim
    // to name the same worst function do not sort the same array: the symbol table
    // re-sorts on the column the reader picked, so agreement has to come from the
    // comparator, not from the order the document happened to arrive in.
    const { container } = render(
      <CodeOutliers
        document={document({
          symbols: [
            symbol({
              name: "third",
              file: 1,
              line: 90,
              cyclomatic: 7,
              cognitive: 3,
            }),
            symbol({
              name: "second",
              file: 1,
              line: 5,
              cyclomatic: 7,
              cognitive: 3,
            }),
            symbol({
              name: "first",
              file: 0,
              line: 60,
              cyclomatic: 7,
              cognitive: 9,
            }),
            symbol({
              name: "zeroth",
              file: 0,
              line: 3,
              cyclomatic: 12,
              cognitive: 1,
            }),
          ],
        })}
      />,
    );
    expect(bandLabels(container, 0)).toEqual([
      "zeroth",
      "first",
      "second",
      "third",
    ]);
  });

  it("never draws a zero-line file, even when there is room for one", () => {
    // Five real files among twenty empty ones — the shape that discriminates. A tree
    // whose non-empty files already fill the ranking cannot tell the filter from its
    // absence, because sorting by code lines descending sinks the empty ones past the
    // cap on its own. Only a *short* ranking has room for them, and a run whose model
    // scaffolded a pile of empty files is exactly when that happens.
    const files = [
      ...Array.from({ length: 20 }, (_, i) => file(`empty/${i}.json`, 0)),
      ...Array.from({ length: 5 }, (_, i) => file(`src/${i}.ts`, 100 - i)),
    ];
    const { container } = render(
      <CodeOutliers document={document({ files, symbols: [] })} />,
    );
    // With no symbols the function figure is not drawn at all, so the file ranking is
    // the only figure on the page.
    const labels = bandLabels(container, 0);
    expect(labels).toEqual([
      "src/0.ts",
      "src/1.ts",
      "src/2.ts",
      "src/3.ts",
      "src/4.ts",
    ]);
  });
});
