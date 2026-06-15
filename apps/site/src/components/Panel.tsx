import type { ReactNode } from "react";
import styles from "./Panel.module.scss";

interface PanelProps {
  children: ReactNode;
  /** Extra class on the wrapper, for layout-specific overrides. */
  className?: string;
}

// Wraps content in the site's standard neon-outlined surface panel. Use it
// around free-flowing prose (About copy, test-case and model descriptions) that
// isn't already inside one of the page-specific panels, so the text stays
// legible over the animated backdrop.
export function Panel({ children, className }: PanelProps) {
  const cls = className ? `${styles.panel} ${className}` : styles.panel;
  return <div className={cls}>{children}</div>;
}
