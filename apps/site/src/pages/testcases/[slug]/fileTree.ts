import type { SeededInput, VariantSummary } from "../../../data/testCases";

// A leaf in the seeded-file tree: one concrete file the run is seeded with.
export interface FileLeaf {
  type: "file";
  /** The file's own name (the last path segment). */
  name: string;
  /** The file's full path within the seeded repository. */
  path: string;
  /** The seeded input this leaf renders. */
  input: SeededInput;
}

// A directory in the seeded-file tree, holding nested directories and files.
export interface DirNode {
  type: "dir";
  /** The directory's own name (the last path segment). */
  name: string;
  /** The directory's full path within the seeded repository. */
  path: string;
  /** Child directories and files, directories first, each sorted by name. */
  children: TreeNode[];
}

export type TreeNode = DirNode | FileLeaf;

/**
 * The full set of files a run of `variant` is seeded with, as a flat list.
 *
 * This unifies the two halves the catalog records separately — the inlined
 * spec/asset files and the rendered reference screenshots — back into the single
 * `reference/<view>.png` layout a real seed materializes, so the browser shows
 * exactly the tree a run receives.
 */
export function variantSeededFiles(variant: VariantSummary): SeededInput[] {
  const references: SeededInput[] = variant.referenceScreenshots.map((shot) => ({
    path: `reference/${shot.view}.png`,
    kind: "image",
    url: shot.url,
  }));
  return [...variant.seededInputs, ...references];
}

/**
 * Build a nested directory tree from a flat list of seeded files.
 *
 * Each file's path is split on `/` into directory segments and a final file
 * name; intermediate directories are created on demand and reused. Directories
 * sort before files and both sort by name, so the tree is stable regardless of
 * the order the files arrive in.
 */
export function buildFileTree(files: SeededInput[]): TreeNode[] {
  const root: DirNode = { type: "dir", name: "", path: "", children: [] };

  for (const input of files) {
    const segments = input.path.split("/").filter((segment) => segment.length > 0);
    const fileName = segments.pop();
    if (fileName === undefined) {
      continue;
    }
    let dir = root;
    // Walk/create the directory chain leading to the file (the segments left
    // after popping the file name).
    for (const name of segments) {
      const path = dir.path ? `${dir.path}/${name}` : name;
      const existing = dir.children.find(
        (node): node is DirNode => node.type === "dir" && node.name === name,
      );
      if (existing) {
        dir = existing;
      } else {
        const created: DirNode = { type: "dir", name, path, children: [] };
        dir.children.push(created);
        dir = created;
      }
    }
    dir.children.push({ type: "file", name: fileName, path: input.path, input });
  }

  sortTree(root.children);
  return root.children;
}

/** Sort a level of the tree (directories first, then files) and recurse. */
function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "dir" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.type === "dir") {
      sortTree(node.children);
    }
  }
}

/** The first file leaf in a depth-first walk, or null when the tree has none. */
export function firstFile(nodes: TreeNode[]): FileLeaf | null {
  for (const node of nodes) {
    if (node.type === "file") {
      return node;
    }
    const found = firstFile(node.children);
    if (found) {
      return found;
    }
  }
  return null;
}
