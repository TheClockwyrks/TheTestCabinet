import { useMemo, useState } from "react";
import { Link, NavLink } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import {
  isAudioAssetKind,
  isParticleAssetKind,
  isVoxelAssetKind,
} from "../../../client";
import { useTestCases } from "../../data/useTestCases";
import type { TestCaseSummary } from "../../data/testCases";
import { routes } from "../../routes";
import type { CatalogTab } from "../../routes";
import styles from "./TestCasesPage.module.scss";

// The catalog's type tabs, always shown in this order so the bar's shape is
// stable regardless of which types the catalog currently holds. The catalog
// shows exactly one tab at a time. Asset-generation is split into four
// asset-family tabs — "2D" (sprite + paint), "3D" (voxel/mesh/skinned),
// "Particle", and "Audio"; the other three map one-to-one to a test type.
const CATALOG_TABS: ReadonlyArray<{ tab: CatalogTab; label: string }> = [
  { tab: "end-to-end", label: "E2E" },
  { tab: "2d", label: "2D" },
  { tab: "3d", label: "3D" },
  { tab: "particle", label: "Particle" },
  { tab: "audio", label: "Audio" },
  { tab: "adversarial", label: "Adversarial" },
  { tab: "performance", label: "Performance" },
];

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
  const [query, setQuery] = useState("");

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

      {status === "loading" && <p className={styles.empty}>Loading catalog…</p>}

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
              {CATALOG_TABS.map((entry) => (
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

// Whether a case belongs under a given tab. The four asset-family tabs all scope
// to asset-generation cases, partitioned by the case's asset kind: 3D is the
// voxel/mesh/skinned family, Particle and Audio are their own families, and 2D
// is the remainder (the sprite and paint kinds, plus a case with no asset kind,
// which defaults to `sprite`). The other tabs map straight to a test type.
function inTab(testCase: TestCaseSummary, tab: CatalogTab): boolean {
  switch (tab) {
    case "2d":
      return (
        testCase.testType === "asset-generation" &&
        !isVoxelAssetKind(testCase.assetKind) &&
        !isParticleAssetKind(testCase.assetKind) &&
        !isAudioAssetKind(testCase.assetKind)
      );
    case "3d":
      return (
        testCase.testType === "asset-generation" &&
        isVoxelAssetKind(testCase.assetKind)
      );
    case "particle":
      return (
        testCase.testType === "asset-generation" &&
        isParticleAssetKind(testCase.assetKind)
      );
    case "audio":
      return (
        testCase.testType === "asset-generation" &&
        isAudioAssetKind(testCase.assetKind)
      );
    case "end-to-end":
      return testCase.testType === "end-to-end";
    case "adversarial":
      return testCase.testType === "adversarial";
    case "performance":
      return testCase.testType === "performance";
  }
}
