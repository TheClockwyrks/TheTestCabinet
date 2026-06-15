import type { ReactNode } from "react";
import { useReadability } from "./ReadabilityContext";
import styles from "./ReadableSurface.module.scss";

interface ReadableSurfaceProps {
  children: ReactNode;
  /** Extra class on the wrapper, for layout-specific overrides. */
  className?: string;
}

// Wraps prose that would otherwise sit straight on the animated backdrop and
// applies the visitor's chosen readability treatment. The treatment is selected
// entirely in CSS via the `data-variant` attribute, so a single element covers
// every variant — boxed, scrimmed, frosted, haloed, or none. Use this around
// any free-flowing text (About copy, test-case and model descriptions) that
// isn't already inside one of the site's surface panels.
export function ReadableSurface({ children, className }: ReadableSurfaceProps) {
  const { variant } = useReadability();
  const cls = className ? `${styles.surface} ${className}` : styles.surface;
  return (
    <div className={cls} data-variant={variant}>
      {children}
    </div>
  );
}
