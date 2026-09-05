// The produced tree, as a tree.
//
// A code-analysis document lists files flatly, in sorted path order, because that is the
// shape an analyzer produces and the shape an aggregation wants. It is not the shape a
// person explores: "did the model split the work?" is answered by walking directories,
// and "where did the code go?" by comparing a directory against its siblings. So the flat
// list is folded back into a tree once, here, and every part of the Code tab's explorer —
// the breadcrumb, the map, the child table, the symbol table's scope — reads that one
// structure.
//
// Every node carries its subtree's aggregates rather than recomputing them per render,
// and carries the file indices beneath it so a selection can filter symbols, imports and
// clones without re-walking paths.

import type {
  CodeAnalysisDocument,
  CodeFileEntry,
  CodeSymbolEntry,
} from "@clockwyrks/run-record/code-analysis";

/** One node of the produced tree: a directory, or one authored file. */
export interface CodeTreeNode {
  /** The node's path relative to the tree root; `""` for the root itself. Also its
   * identity in the explorer's URL-free selection state. */
  path: string;
  /** What the explorer shows. A directory whose chain was collapsed carries the whole
   * collapsed run (`app/pages/runs`), because three clicks through directories that hold
   * exactly one thing is three clicks that tell you nothing. */
  name: string;
  kind: "dir" | "file";
  /** Index into {@link CodeAnalysisDocument.files}, for a file node. */
  fileIndex?: number;
  /** Directories first, then files; each group in path order. */
  children: CodeTreeNode[];
  /** Every file index in this subtree, so a selection can scope the symbol table without
   * re-walking paths. */
  fileIndices: number[];
  /** Aggregates over the subtree. A file node's are its own. */
  files: number;
  parsedFiles: number;
  testFiles: number;
  bytes: number;
  codeLines: number;
  functions: number;
  /** Summed cyclomatic complexity of the functions beneath this node — the numerator of
   * the mean the explorer shows. A sum rather than a mean because means do not add. */
  cyclomatic: number;
}

function emptyNode(
  path: string,
  name: string,
  kind: "dir" | "file",
): CodeTreeNode {
  return {
    path,
    name,
    kind,
    children: [],
    fileIndices: [],
    files: 0,
    parsedFiles: 0,
    testFiles: 0,
    bytes: 0,
    codeLines: 0,
    functions: 0,
    cyclomatic: 0,
  };
}

// Fold one file's figures into a node. Called on every ancestor of the file, so a
// directory's figures are always exactly the sum of what is under it.
function accumulate(node: CodeTreeNode, file: CodeFileEntry, index: number) {
  node.fileIndices.push(index);
  node.files += 1;
  if (file.language) node.parsedFiles += 1;
  if (file.isTest) node.testFiles += 1;
  node.bytes += file.bytes;
  node.codeLines += file.codeLines;
  node.functions += file.functions;
  node.cyclomatic += file.cyclomatic;
}

/**
 * Fold the document's flat file list into a tree.
 *
 * Directory chains with a single child directory are collapsed into one node, the way a
 * file browser does: a run whose whole implementation lives under `src/game/systems` opens
 * on something worth looking at rather than on three directories in a row that each hold
 * one thing.
 */
export function buildCodeTree(files: readonly CodeFileEntry[]): CodeTreeNode {
  const root = emptyNode("", "", "dir");
  files.forEach((file, index) => {
    const segments = file.path.split("/").filter((s) => s.length > 0);
    let node = root;
    accumulate(node, file, index);
    segments.forEach((segment, depth) => {
      const isLeaf = depth === segments.length - 1;
      const path = segments.slice(0, depth + 1).join("/");
      let child = node.children.find((c) => c.path === path);
      if (!child) {
        child = emptyNode(path, segment, isLeaf ? "file" : "dir");
        if (isLeaf) child.fileIndex = index;
        node.children.push(child);
      }
      accumulate(child, file, index);
      node = child;
    });
  });
  sortChildren(root);
  return collapse(root);
}

// Directories before files, each group in path order — the ordering a file browser uses,
// and the one that keeps a directory's contents from being interleaved with its siblings.
function sortChildren(node: CodeTreeNode) {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  for (const child of node.children) sortChildren(child);
}

// Collapse a directory that holds exactly one directory and nothing else into its child,
// joining the names. The root is never collapsed away: it is the explorer's home, and a
// breadcrumb with no root has nowhere to go back to.
function collapse(node: CodeTreeNode): CodeTreeNode {
  const children = node.children.map(collapse);
  if (
    node.kind === "dir" &&
    node.path !== "" &&
    children.length === 1 &&
    children[0]!.kind === "dir"
  ) {
    const only = children[0]!;
    return { ...only, name: `${node.name}/${only.name}` };
  }
  return { ...node, children };
}

/** The node at `path`, or the root when the path no longer resolves (a stale selection
 * after the document is replaced), so the explorer degrades to its home rather than to a
 * blank panel. */
export function findCodeNode(root: CodeTreeNode, path: string): CodeTreeNode {
  if (path === "") return root;
  let node: CodeTreeNode | undefined = root;
  while (node) {
    if (node.path === path) return node;
    // The collapsed names mean a child's path can jump more than one segment, so descend
    // by prefix rather than by splitting the target path.
    node = node.children.find(
      (child) => path === child.path || path.startsWith(`${child.path}/`),
    );
  }
  return root;
}

/** The chain from the root down to `path`, inclusive — the breadcrumb. */
export function codeBreadcrumb(
  root: CodeTreeNode,
  path: string,
): CodeTreeNode[] {
  const trail: CodeTreeNode[] = [root];
  if (path === "") return trail;
  let node: CodeTreeNode | undefined = root;
  while (node) {
    const next: CodeTreeNode | undefined = node.children.find(
      (child) => path === child.path || path.startsWith(`${child.path}/`),
    );
    if (!next) break;
    trail.push(next);
    if (next.path === path) break;
    node = next;
  }
  return trail;
}

/**
 * The symbols under a node, worst first.
 *
 * Sorted with a total tie-break — cyclomatic, then cognitive, then file, then line — so
 * the table is a pure function of the document: two functions with equal complexity would
 * otherwise swap places between renders. The same ordering the CLI report uses, so the
 * two name the same worst function.
 */
export function symbolsUnder(
  document: CodeAnalysisDocument,
  node: CodeTreeNode,
): CodeSymbolEntry[] {
  const scope = new Set(node.fileIndices);
  return document.symbols
    .filter((symbol) => scope.has(symbol.file))
    .sort(
      (a, b) =>
        b.cyclomatic - a.cyclomatic ||
        b.cognitive - a.cognitive ||
        a.file - b.file ||
        a.line - b.line,
    );
}

/** The mean cyclomatic complexity of the functions under a node, or `null` when it holds
 * none — which is a different fact from "its functions are simple". */
export function meanCyclomatic(node: CodeTreeNode): number | null {
  return node.functions > 0 ? node.cyclomatic / node.functions : null;
}
