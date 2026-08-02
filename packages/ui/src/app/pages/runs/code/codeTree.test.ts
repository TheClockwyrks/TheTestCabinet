import { describe, expect, it } from "vitest";
import type {
  CodeAnalysisDocument,
  CodeFileEntry,
  CodeSymbolEntry,
} from "@test-cabinet/run-record/code-analysis";
import {
  buildCodeTree,
  codeBreadcrumb,
  findCodeNode,
  meanCyclomatic,
  symbolsUnder,
} from "./codeTree";

function file(path: string, over: Partial<CodeFileEntry> = {}): CodeFileEntry {
  return {
    path,
    language: "typeScript",
    bytes: 100,
    codeLines: 10,
    commentLines: 1,
    blankLines: 1,
    functions: 1,
    cyclomatic: 2,
    cognitive: 1,
    fanOut: 0,
    fanIn: 0,
    isTest: false,
    ...over,
  };
}

describe("buildCodeTree", () => {
  const tree = buildCodeTree([
    file("index.html", { language: undefined, codeLines: 0, functions: 0 }),
    file("src/main.ts", { codeLines: 40, functions: 4, cyclomatic: 12 }),
    file("src/game/loop.ts", { codeLines: 60, functions: 6, cyclomatic: 30 }),
    file("src/game/draw.ts", { codeLines: 20, functions: 2, cyclomatic: 4 }),
  ]);

  it("nests files under their directories", () => {
    expect(tree.children.map((c) => c.path)).toEqual(["src", "index.html"]);
    const src = tree.children.find((c) => c.path === "src")!;
    // Directories before files, each group in path order.
    expect(src.children.map((c) => c.path)).toEqual([
      "src/game",
      "src/main.ts",
    ]);
  });

  // A directory's figures must be exactly the sum of what is under it — the explorer
  // compares siblings by them, and a rollup that double-counts or drops a file makes
  // every comparison on the page wrong.
  it("rolls a subtree's figures up into its directory", () => {
    const game = findCodeNode(tree, "src/game");
    expect(game.files).toBe(2);
    expect(game.codeLines).toBe(80);
    expect(game.functions).toBe(8);
    expect(meanCyclomatic(game)).toBeCloseTo(34 / 8);
    expect(tree.codeLines).toBe(120);
    expect(tree.files).toBe(4);
  });

  it("counts the files a front end never parsed separately", () => {
    expect(tree.files).toBe(4);
    expect(tree.parsedFiles).toBe(3);
  });

  it("has no functions, and so no mean, where nothing was scored", () => {
    const html = findCodeNode(tree, "index.html");
    expect(meanCyclomatic(html)).toBeNull();
  });

  // Three clicks through directories that each hold one thing is three clicks that
  // tell you nothing, so the chain collapses the way a file browser's does.
  it("collapses a chain of single-child directories", () => {
    const deep = buildCodeTree([
      file("a/b/c/one.ts"),
      file("a/b/c/two.ts"),
      file("top.ts"),
    ]);
    expect(deep.children.map((c) => c.name)).toEqual(["a/b/c", "top.ts"]);
    // The collapsed node keeps the deepest path, so a selection still resolves.
    expect(deep.children[0]!.path).toBe("a/b/c");
    expect(findCodeNode(deep, "a/b/c").files).toBe(2);
  });

  it("does not collapse a directory that holds a file beside its subdirectory", () => {
    const mixed = buildCodeTree([file("a/b/one.ts"), file("a/two.ts")]);
    expect(mixed.children.map((c) => c.name)).toEqual(["a"]);
  });
});

describe("findCodeNode and codeBreadcrumb", () => {
  const tree = buildCodeTree([
    file("src/game/loop.ts"),
    file("src/game/draw.ts"),
    file("src/main.ts"),
  ]);

  it("resolves a path through a collapsed segment", () => {
    expect(findCodeNode(tree, "src/game/loop.ts").kind).toBe("file");
  });

  // A stale selection (the document was replaced under it) must land on the home
  // rather than on a blank panel.
  it("falls back to the root for a path that no longer resolves", () => {
    expect(findCodeNode(tree, "gone/away.ts").path).toBe("");
  });

  it("walks the trail from the root down to the selection", () => {
    expect(codeBreadcrumb(tree, "src/game/loop.ts").map((n) => n.path)).toEqual([
      "",
      "src",
      "src/game",
      "src/game/loop.ts",
    ]);
    expect(codeBreadcrumb(tree, "")).toHaveLength(1);
  });
});

describe("symbolsUnder", () => {
  function symbol(
    fileIndex: number,
    name: string,
    cyclomatic: number,
    line: number,
  ): CodeSymbolEntry {
    return {
      file: fileIndex,
      name,
      line,
      lines: 10,
      cyclomatic,
      cognitive: cyclomatic,
      maxNesting: 1,
      parameters: 1,
      exits: 1,
      exported: false,
    };
  }

  const files = [file("src/a.ts"), file("src/b.ts"), file("other/c.ts")];
  const document = {
    analyzerVersion: 2,
    summary: {} as CodeAnalysisDocument["summary"],
    files,
    symbols: [
      symbol(0, "small", 2, 5),
      symbol(1, "huge", 40, 9),
      symbol(2, "elsewhere", 99, 1),
      symbol(0, "medium", 7, 30),
    ],
    imports: [],
    cycles: [],
    clones: [],
  } as unknown as CodeAnalysisDocument;

  it("scopes the symbols to the selected subtree", () => {
    const tree = buildCodeTree(files);
    const names = symbolsUnder(document, findCodeNode(tree, "src")).map(
      (s) => s.name,
    );
    // `elsewhere` is the worst function in the document and is still excluded: the
    // table is scoped to the selection, not merely sorted by it.
    expect(names).toEqual(["huge", "medium", "small"]);
  });

  it("orders worst-first with a total tie-break", () => {
    const tree = buildCodeTree(files);
    const ordered = symbolsUnder(document, tree);
    expect(ordered.map((s) => s.name)).toEqual([
      "elsewhere",
      "huge",
      "medium",
      "small",
    ]);
  });
});
