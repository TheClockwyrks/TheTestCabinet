import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.scss";

interface MarkdownProps {
  /** The Markdown source to render. */
  children: string;
  /** Extra class on the wrapper, for layout-specific overrides. */
  className?: string;
}

// The single Markdown renderer shared across the GUIs. Every piece of prose —
// run writeups, test-case descriptions, model descriptions, About copy — goes
// through here so GFM support (tables, strikethrough, task lists) and the
// themed typography stay in one place. Wrap, don't reach for react-markdown
// directly.
export function Markdown({ children, className }: MarkdownProps) {
  const cls = className ? `${styles.prose} ${className}` : styles.prose;
  return (
    <div className={cls}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
