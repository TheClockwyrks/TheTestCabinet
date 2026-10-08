import { useMemo } from "react";
import { NavLink } from "react-router";

import styles from "./catalog-tabs.module.scss";
import { useGalleryData } from "../../data/galleryContext";
import { CATALOG_TABS, inTab } from "../../data/testCaseTabs";
import { useSuiteReads } from "../../data/use-test-suites";
import { useTestCases } from "../../data/useTestCases";
import { routes } from "../../routes";
import type { CatalogTab } from "../../routes";

/** Which entry of the bar is selected: one of the catalog's type tabs, or the
 * Test Suites tab, which is not a test type and so is not a `CatalogTab`. */
export type CatalogTabSelection = CatalogTab | "suites";

// The Test Cases section's tab bar, rendered identically by the catalog page and
// the Test Suites page so the bar does not change shape with the selection.
//
// The type tabs come from `../../data/testCaseTabs` (shared with the coverage
// plan editor). On a console (canExecute) they are all shown regardless of which
// types the catalog currently holds, so the bar's shape is stable even for a type
// that has cases but no runs yet. On the static gallery site the catalog holds
// only cases with a published run, so a tab with no case under it is hidden —
// mirroring, for the tab bar, the way the grid already lists only published
// cases.
//
// Test Suites leads the bar wherever the host's transport exposes the suite reads
// (`useSuiteReads`), which is the same condition the route is mounted on: where
// it is absent the entry is omitted and the bar renders exactly as it did before
// suites existed.
export function CatalogTabs({ active }: { active: CatalogTabSelection }) {
  const { testCases } = useTestCases();
  const { canExecute } = useGalleryData();
  const suiteReads = useSuiteReads();

  const visibleTabs = useMemo(
    () =>
      canExecute
        ? CATALOG_TABS
        : CATALOG_TABS.filter((entry) =>
            testCases.some((testCase) => inTab(testCase, entry.tab)),
          ),
    [canExecute, testCases],
  );

  return (
    <nav className={styles.tabs} aria-label="Test type">
      {suiteReads && (
        <NavLink
          to={routes.testCasesSuites()}
          className={
            active === "suites"
              ? [styles.tab, styles.tabActive].filter(Boolean).join(" ")
              : styles.tab
          }
        >
          Test Suites
        </NavLink>
      )}
      {visibleTabs.map((entry) => (
        <NavLink
          key={entry.tab}
          to={routes.testCasesCatalog(entry.tab)}
          className={
            entry.tab === active
              ? [styles.tab, styles.tabActive].filter(Boolean).join(" ")
              : styles.tab
          }
        >
          {entry.label}
        </NavLink>
      ))}
    </nav>
  );
}
