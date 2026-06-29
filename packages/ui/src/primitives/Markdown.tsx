import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.scss";

interface MarkdownProps {
  /** The Markdown source to render. */
  children: string;
  /** Extra class on the wrapper, for layout-specific overrides. */
  className?: string;
  /**
   * Render a single newline as a line break (GitHub-comment style) rather than
   * collapsing it into a space. Use for prose typed in a plain textarea — a run
   * review writeup — where the author means each line break literally; leave off
   * for authored Markdown (docs, descriptions), where the CommonMark default of
   * collapsing soft breaks is correct.
   */
  breaks?: boolean;
}

// A minimal node shape for the soft-break transform below: every mdast node has a
// `type`, text nodes carry a `value`, and container nodes carry `children`.
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

// A tiny remark transform that turns soft line breaks (a single `\n` inside a
// paragraph, which CommonMark renders as a space) into hard breaks, so prose
// typed in a textarea keeps the line breaks its author intended. Mirrors what the
// `remark-breaks` plugin does, inline, so this stays dependency-free. Only text
// nodes are split — code spans/blocks hold their newlines in `value`, not in
// child text nodes, so they are left untouched.
function remarkSoftBreaks() {
  const split = (node: MdNode): void => {
    if (!node.children) return;
    const out: MdNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && child.value?.includes("\n")) {
        child.value.split("\n").forEach((part, index) => {
          if (index > 0) out.push({ type: "break" });
          out.push({ type: "text", value: part });
        });
      } else {
        split(child);
        out.push(child);
      }
    }
    node.children = out;
  };
  return (tree: MdNode): void => split(tree);
}

// The single Markdown renderer shared across the GUIs. Every piece of prose —
// run writeups, test-case descriptions, model descriptions, About copy — goes
// through here so GFM support (tables, strikethrough, task lists) and the
// themed typography stay in one place. Wrap, don't reach for react-markdown
// directly.
export function Markdown({
  children,
  className,
  breaks = false,
}: MarkdownProps) {
  const cls = className ? `${styles.prose} ${className}` : styles.prose;
  const plugins = (
    breaks ? [remarkGfm, remarkSoftBreaks] : [remarkGfm]
  ) as Options["remarkPlugins"];
  return (
    <div className={cls}>
      <ReactMarkdown remarkPlugins={plugins}>{children}</ReactMarkdown>
    </div>
  );
}
