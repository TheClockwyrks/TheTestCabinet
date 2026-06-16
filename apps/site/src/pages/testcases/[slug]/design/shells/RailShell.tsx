import { NavLink } from "react-router";
import type { DetailShellProps } from "../types";
import { useDetailTabs } from "../useDetailTabs";
import styles from "./RailShell.module.scss";

// A full structural rework: instead of a horizontal tab strip over the body, the
// case identity and section navigation move into a sticky vertical rail on the
// left, and the active tab's body fills a wide content column on the right. The
// variant selector lives in the rail too, so every control for the page sits in
// one column. On narrow screens the rail collapses above the content.
export function RailShell({
  testCase,
  variant,
  setVariant,
  tab,
  children,
}: DetailShellProps) {
  const tabs = useDetailTabs(testCase.slug, tab);

  return (
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <div className={styles.identity}>
          <h1 className={styles.title}>{testCase.name}</h1>
          <div className={styles.badges}>
            <span
              className={styles.difficulty}
              data-level={testCase.difficulty}
            >
              {testCase.difficulty}
            </span>
            <span className={styles.version}>{testCase.latestVersion}</span>
          </div>
          {testCase.tags.length > 0 && (
            <div className={styles.tags}>
              {testCase.tags.map((entry) => (
                <span key={entry} className={styles.tag}>
                  {entry}
                </span>
              ))}
            </div>
          )}
        </div>

        <nav className={styles.nav} aria-label="Test case sections">
          {tabs.map((entry) => (
            <NavLink
              key={entry.key}
              to={entry.to}
              className={
                entry.active
                  ? `${styles.navLink} ${styles.navActive}`
                  : styles.navLink
              }
            >
              <span className={styles.navMark} aria-hidden="true" />
              {entry.label}
            </NavLink>
          ))}
        </nav>

        <label className={styles.variant}>
          <span className={styles.variantLabel}>Variant</span>
          <select
            className={styles.variantSelect}
            value={variant.slug}
            onChange={(event) => setVariant(event.target.value)}
          >
            {testCase.variants.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </aside>

      <div className={styles.body}>{children}</div>
    </div>
  );
}
