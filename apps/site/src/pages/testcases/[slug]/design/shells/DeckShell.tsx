import { NavLink } from "react-router";
import type { DetailShellProps } from "../types";
import { useDetailTabs } from "../useDetailTabs";
import styles from "./DeckShell.module.scss";

// A cartridge direction: the case identity sits inside a heavily framed header
// card (a label on an arcade cartridge), and the tabs render as a boxed
// segmented control where the active segment is filled rather than underlined.
// Paired with the editor-style deck specs view, the whole page reads as a piece
// of hardware rather than a document.
export function DeckShell({
  testCase,
  variant,
  setVariant,
  tab,
  children,
}: DetailShellProps) {
  const tabs = useDetailTabs(testCase.slug, tab);

  return (
    <div className={styles.shell}>
      <header className={styles.cartridge}>
        <div className={styles.cartridgeTop}>
          <span className={styles.notch} aria-hidden="true" />
          <span className={styles.notch} aria-hidden="true" />
          <span className={styles.notch} aria-hidden="true" />
        </div>
        <div className={styles.label}>
          <h1 className={styles.title}>{testCase.name}</h1>
          <div className={styles.meta}>
            <span
              className={styles.difficulty}
              data-level={testCase.difficulty}
            >
              {testCase.difficulty}
            </span>
            <span className={styles.version}>{testCase.latestVersion}</span>
            {testCase.tags.map((entry) => (
              <span key={entry} className={styles.tag}>
                {entry}
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className={styles.controls}>
        <nav className={styles.segments} aria-label="Test case sections">
          {tabs.map((entry) => (
            <NavLink
              key={entry.key}
              to={entry.to}
              className={
                entry.active
                  ? `${styles.segment} ${styles.segmentActive}`
                  : styles.segment
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
