import type { ReactNode } from "react";
import { NavLink, useLocation, useParams } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { useTestCases } from "../../data/useTestCases";
import type { TestCaseSummary, VariantSummary } from "../../data/testCases";
import { routes } from "../../routes";
import { useSelectedVariant } from "../../pages/testcases/[slug]/useSelectedVariant";
import styles from "./TestCaseDetailLayout.module.scss";

// The detail page's tabs. Each is a distinct route; this drives which tab link
// reads as active.
export type DetailTab = "overview" | "specs" | "references" | "runs";

interface TestCaseDetailLayoutProps {
  /** Which tab the rendering page represents. */
  tab: DetailTab;
  /** The tab body, given the resolved case and the selected variant. */
  children: (ctx: {
    testCase: TestCaseSummary;
    variant: VariantSummary;
  }) => ReactNode;
}

// Shared chrome for every test-case detail tab: the title and metadata, the
// page-level variant selector that drives all tabs at once, and the tab
// navigation. It resolves the case from the URL slug and the variant from the
// query string, then hands both to the active tab's body. Resolving (and the
// not-found state) lives here so the three tab pages stay thin and never
// duplicate it.
export function TestCaseDetailLayout({
  tab,
  children,
}: TestCaseDetailLayoutProps) {
  const { slug } = useParams<{ slug: string }>();
  const { search } = useLocation();
  const { testCases } = useTestCases();
  const testCase = testCases.find((entry) => entry.slug === slug);
  // Called unconditionally (hook rules); it tolerates an undefined case and
  // simply resolves no variant, which the guard below turns into the not-found
  // state.
  const [variant, setVariant] = useSelectedVariant(testCase);

  if (!testCase || !variant) {
    return (
      <PageLayout>
        <p className={styles.notFound}>
          No test case found for &ldquo;{slug}&rdquo;.
        </p>
      </PageLayout>
    );
  }

  // Tab links carry the current query string so switching tabs preserves the
  // selected variant.
  const tabs: { key: DetailTab; label: string; to: string }[] = [
    { key: "overview", label: "Overview", to: routes.testCaseDetail(testCase.slug) },
    { key: "specs", label: "Specifications", to: routes.testCaseSpecs(testCase.slug) },
    { key: "references", label: "References", to: routes.testCaseReferences(testCase.slug) },
    { key: "runs", label: "Runs", to: routes.testCaseRuns(testCase.slug) },
  ];

  return (
    <PageLayout>
      {/* Two rows spanning the content width: the title against the version,
          then the tags against the difficulty rating. */}
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{testCase.name}</h1>
          <span className={styles.version}>{testCase.latestVersion}</span>
        </div>
        <div className={styles.metaRow}>
          <div className={styles.tags}>
            {testCase.tags.map((entry) => (
              <span key={entry} className={styles.tag}>
                {entry}
              </span>
            ))}
          </div>
          <span className={styles.difficulty} data-level={testCase.difficulty}>
            {testCase.difficulty}
          </span>
        </div>
      </header>

      <div className={styles.controls}>
        <nav className={styles.tabs} aria-label="Test case sections">
          {tabs.map((entry) => (
            <NavLink
              key={entry.key}
              to={{ pathname: entry.to, search }}
              className={
                entry.key === tab
                  ? `${styles.tab} ${styles.tabActive}`
                  : styles.tab
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

      {children({ testCase, variant })}
    </PageLayout>
  );
}
