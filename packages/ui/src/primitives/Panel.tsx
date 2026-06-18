import type { ReactNode } from "react";
import styles from "./Panel.module.scss";

interface PanelProps {
  children: ReactNode;
  /** Extra class on the wrapper, for layout-specific overrides. */
  className?: string;
}

// Wraps content in the standard neon-outlined surface panel: a shared
// translucent background inside a softly glowing card. Use it around
// free-flowing prose that isn't already inside a page-specific panel so the
// text stays legible over a busy backdrop.
export function Panel({ children, className }: PanelProps) {
  const cls = className ? `${styles.panel} ${className}` : styles.panel;
  return <div className={cls}>{children}</div>;
}
