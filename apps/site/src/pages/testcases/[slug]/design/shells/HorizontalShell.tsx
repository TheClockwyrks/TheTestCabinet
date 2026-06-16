import { NavLink } from "react-router";
import type { DetailShellProps } from "../types";
import { useDetailTabs } from "../useDetailTabs";
import styles from "./HorizontalShell.module.scss";

// The current chrome, lightly refined: a title and metadata block above a
// control strip that pairs the horizontal tab nav with the page-level variant
// selector. Shared by the "refined" and "document" designs — both keep this
// chrome and differ only in how the Specifications body is rendered.
export function HorizontalShell({
  testCase,
  variant,
  setVariant,
  tab,
  children,
}: DetailShellProps) {
  const tabs = useDetailTabs(testCase.slug, tab);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>{testCase.name}</h1>
        <div className={styles.meta}>
          <span className={styles.difficulty} data-level={testCase.difficulty}>
            {testCase.difficulty}
          </span>
          <span className={styles.version}>{testCase.latestVersion}</span>
          {testCase.tags.map((entry) => (
            <span key={entry} className={styles.tag}>
              {entry}
            </span>
          ))}
        </div>
      </header>

      <div className={styles.controls}>
        <nav className={styles.tabs} aria-label="Test case sections">
          {tabs.map((entry) => (
            <NavLink
              key={entry.key}
              to={entry.to}
              className={
                entry.active ? `${styles.tab} ${styles.tabActive}` : styles.tab
              }
            >
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
      </div>

      {children}
    </div>
  );
}
