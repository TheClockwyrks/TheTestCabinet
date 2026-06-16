import { useMemo, useState } from "react";
import { Markdown } from "../../../components/Markdown";
import type { SeededInput, VariantSummary } from "../../../data/testCases";
import {
  buildFileTree,
  firstFile,
  variantSeededFiles,
  type TreeNode,
} from "./fileTree";
import styles from "./SpecFileBrowser.module.scss";

interface SpecFileBrowserProps {
  /** The variant whose seeded files are browsed. */
  variant: VariantSummary;
}

// A filesystem-like browser over the files a run of the selected variant is
// seeded with: a directory tree on the left, the selected file's contents on the
// right. The tree mirrors the seeded repository exactly — the same layout `tcab
// seed --variant <slug>` materializes — so what the site shows is what a model
// receives. Mount this with a `key` on the variant slug so switching variants
// resets the selection to the new tree's default.
export function SpecFileBrowser({ variant }: SpecFileBrowserProps) {
  const files = useMemo(() => variantSeededFiles(variant), [variant]);
  const tree = useMemo(() => buildFileTree(files), [files]);
  const initial = useMemo(() => defaultSelection(files, tree), [files, tree]);
  const [selectedPath, setSelectedPath] = useState<string | null>(initial);

  const selected =
    files.find((file) => file.path === selectedPath) ??
    files.find((file) => file.path === initial) ??
    null;

  if (files.length === 0) {
    return <p className={styles.empty}>This variant seeds no files.</p>;
  }

  return (
    <div className={styles.browser}>
      <nav className={styles.sidebar} aria-label="Seeded files">
        <ul className={styles.tree}>
          {tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selected?.path ?? null}
              onSelect={setSelectedPath}
            />
          ))}
        </ul>
      </nav>
      <div className={styles.content}>
        {selected ? (
          <FileView input={selected} />
        ) : (
          <p className={styles.empty}>Select a file to view it.</p>
        )}
      </div>
    </div>
  );
}

// One node of the tree: a collapsible directory (with its children) or a
// selectable file. Directories start expanded so the whole seeded tree is
// visible at a glance.
function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  // Indent each level with padding rather than nested margins so the hit target
  // still spans the full sidebar width.
  const indent = { paddingLeft: `${depth * 1 + 0.75}rem` };

  if (node.type === "dir") {
    return (
      <li>
        <button
          type="button"
          className={styles.dir}
          style={indent}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={styles.twisty}>{open ? "▾" : "▸"}</span>
          <span className={styles.dirName}>{node.name}</span>
        </button>
        {open && (
          <ul className={styles.tree}>
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const active = node.path === selectedPath;
  return (
    <li>
      <button
        type="button"
        className={active ? `${styles.file} ${styles.fileActive}` : styles.file}
        style={indent}
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(node.path)}
      >
        <span className={styles.fileName}>{node.name}</span>
      </button>
    </li>
  );
}

// The right-hand pane: a path header plus the file's contents — prose for
// Markdown, a fenced code block for other text, the rendered image for a
// reference screenshot or binary asset.
function FileView({ input }: { input: SeededInput }) {
  return (
    <article className={styles.fileView}>
      <header className={styles.fileHead}>
        <span className={styles.filePath}>{input.path}</span>
        <span className={styles.fileKind}>{input.kind}</span>
      </header>
      {input.kind === "text" && input.text !== undefined ? (
        <Markdown className={styles.fileBody}>
          {fence(input.path, input.text)}
        </Markdown>
      ) : input.url ? (
        <img className={styles.image} src={input.url} alt={input.path} />
      ) : null}
    </article>
  );
}

// Markdown source files render as prose; every other text file renders as a
// fenced code block so it is shown verbatim, tagged with its extension as the
// language hint.
function fence(path: string, text: string): string {
  if (path.endsWith(".md") || path.endsWith(".markdown")) {
    return text;
  }
  const lang = path.split(".").pop() ?? "";
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

// The file selected when the browser first opens: the spec overview when the
// variant seeds one (the natural entry point), otherwise the first text file,
// otherwise the first file of any kind.
function defaultSelection(files: SeededInput[], tree: TreeNode[]): string | null {
  const overview = files.find((file) => file.path.endsWith("overview.md"));
  if (overview) {
    return overview.path;
  }
  const firstText = files.find((file) => file.kind === "text");
  if (firstText) {
    return firstText.path;
  }
  return firstFile(tree)?.path ?? null;
}
