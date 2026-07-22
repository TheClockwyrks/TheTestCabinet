import { useMemo, useState } from "react";
import { Link, NavLink } from "react-router";
import { Spinner } from "@test-cabinet/ui";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useTestCases } from "../../data/useTestCases";
import { useGalleryData } from "../../data/galleryContext";
import type { TestCaseSummary } from "../../data/testCases";
import { CATALOG_TABS, inTab } from "../../data/testCaseTabs";
import { routes } from "../../routes";
import type { CatalogTab } from "../../routes";
import styles from "./TestCasesPage.module.scss";

// The catalog's type tabs are defined in `../../data/testCaseTabs` (shared with
// the coverage plan editor). On a console (canExecute) they are all shown
// regardless of which types the catalog currently holds, so the bar's shape is
// stable even for a type that has cases but no runs yet. On the static gallery
// site the catalog holds only cases with a published run, so a tab with no case
// under it is hidden (see `visibleTabs`) — mirroring, for the tab bar, the way
// the grid already lists only published cases. The catalog shows exactly one tab
// at a time.

interface TestCasesPageProps {
  /** Which type tab this route renders. Carried in the URL (one route per tab)
   * so the selection survives a reload and is linkable. */
  tab: CatalogTab;
}

// The test-case catalog: every case as a full-width neon card showing its title
// and a short summary. A tab bar scopes the grid to a single type — the tab is
// the URL (one route per tab), so a reload keeps it — and a client-side search
// narrows by title within it. Cards link to the per-slug detail page and are
// listed alphabetically — never ranked.
export function TestCasesPage({ tab }: TestCasesPageProps) {
  const { testCases, status } = useTestCases();
  const { canExecute } = useGalleryData();
  const [query, setQuery] = useState("");

  // On the static site (no execution) drop tabs the catalog has no case for, so
  // the bar advertises only types with a published run; the consoles keep the
  // full, stable bar.
  const visibleTabs = useMemo(
    () =>
      canExecute
        ? CATALOG_TABS
        : CATALOG_TABS.filter((entry) =>
            testCases.some((testCase) => inTab(testCase, entry.tab)),
          ),
    [canExecute, testCases],
  );

  const shown = useMemo(
    () =>
      testCases
        .filter((testCase) => matches(testCase, query, tab))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [testCases, query, tab],
  );

  return (
    <PageLayout>
      <PromptHeader
        command="--test-cases"
        blink
        comment={<>// the specs harnesses build against</>}
      />

      {status === "loading" && (
        <Spinner variant="flap" label="Loading catalog…" />
      )}

      {status === "error" && (
        <p className={styles.error}>
          Couldn&apos;t reach the backend — the test-case catalog is
          unavailable.
        </p>
      )}

      {status === "ready" && (
        <>
          <div className={styles.controls}>
            <nav className={styles.tabs} aria-label="Test type">
              {visibleTabs.map((entry) => (
                <NavLink
                  key={entry.tab}
                  to={routes.testCasesCatalog(entry.tab)}
                  className={
                    entry.tab === tab
                      ? `${styles.tab} ${styles.tabActive}`
                      : styles.tab
                  }
                >
                  {entry.label}
                </NavLink>
              ))}
            </nav>
            <input
              className={styles.search}
              type="search"
              placeholder="Search by title, tag, or difficulty…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search test cases"
            />
          </div>

          {shown.length === 0 ? (
            <p className={styles.empty}>No test cases match.</p>
          ) : (
            <ul className={styles.list}>
              {shown.map((testCase) => (
                <li key={testCase.slug}>
                  <Link
                    to={routes.testCaseDetail(testCase.slug)}
                    className={styles.card}
                  >
                    <div className={styles.cardHeader}>
                      <h2 className={styles.cardTitle}>{testCase.name}</h2>
                      <span
                        className={styles.difficulty}
                        data-level={testCase.difficulty}
                      >
                        {testCase.difficulty}
                      </span>
                    </div>
                    {testCase.summary && (
                      <p className={styles.summary}>{testCase.summary}</p>
                    )}
                    {testCase.tags.length > 0 && (
                      <ul className={styles.tags}>
                        {testCase.tags.map((value) => (
                          <li key={value} className={styles.tag}>
                            {value}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PageLayout>
  );
}

// Scope to the selected tab, then a case-insensitive search over the title,
// tags, and difficulty — so tags and difficulty are usable as filters even
// though the tab bar is the only faceted control.
function matches(
  testCase: TestCaseSummary,
  query: string,
  tab: CatalogTab,
): boolean {
  if (!inTab(testCase, tab)) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [testCase.name, testCase.difficulty, ...testCase.tags]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}
