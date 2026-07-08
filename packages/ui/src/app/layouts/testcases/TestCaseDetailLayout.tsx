import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useParams } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { useGalleryData } from "../../data/galleryContext";
import { useTestCases } from "../../data/useTestCases";
import type { TestCaseSummary, VariantSummary } from "../../data/testCases";
import { routes } from "../../routes";
import { useSelectedVariant } from "../../pages/testcases/[slug]/useSelectedVariant";
import styles from "./TestCaseDetailLayout.module.scss";

// The detail page's tabs. Each is a distinct route; this drives which tab link
// reads as active.
export type DetailTab =
  | "overview"
  | "inputs"
  | "runs"
  | "leaderboard"
  | "metrics"
  | "changelog"
  | "arena";

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
  const { canExecute, arena } = useGalleryData();
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
    {
      key: "overview",
      label: "Overview",
      to: routes.testCaseDetail(testCase.slug),
    },
    {
      key: "inputs",
      label: "Inputs",
      to: routes.testCaseInputs(testCase.slug),
    },
    { key: "runs", label: "Runs", to: routes.testCaseRuns(testCase.slug) },
    {
      key: "leaderboard",
      label: "Leaderboard",
      to: routes.testCaseLeaderboard(testCase.slug),
    },
    {
      key: "metrics",
      label: "Metrics",
      to: routes.testCaseMetrics(testCase.slug),
    },
    {
      key: "changelog",
      label: "Changelog",
      to: routes.testCaseChangelog(testCase.slug),
    },
  ];
  // The Arena tab is shown only for an adversarial case on a console that can run
  // matches (a connected worker exposes the arena capability); it is hidden on the
  // static site and for every other test type.
  if (canExecute && arena && testCase.testType === "adversarial") {
    tabs.push({
      key: "arena",
      label: "Arena",
      to: routes.testCaseArena(testCase.slug),
    });
  }

  return (
    <PageLayout>
      {/* Two rows spanning the content width: the title (with the version sat
          immediately after it) against the difficulty rating, then the tags
          against the page-level actions. */}
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>{testCase.name}</h1>
            <span className={styles.version}>{testCase.latestVersion}</span>
          </div>
          <span className={styles.difficulty} data-level={testCase.difficulty}>
            {testCase.difficulty}
          </span>
        </div>
        <div className={styles.metaRow}>
          <div className={styles.tags}>
            {testCase.tags.map((entry) => (
              <span key={entry} className={styles.tag}>
                {entry}
              </span>
            ))}
          </div>
          {/* Page-level actions live in the header (not the tab strip): the
              variant selector drives every tab at once, and the Run action
              carries the viewed case + variant into the new-run form. Keeping
              them here leaves the tab strip a clean single row that reads like
              the run and model detail strips, and a long variant name can no
              longer shove the Run action onto its own line. */}
          <div className={styles.actionRow}>
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
            {/* Only the consoles can launch runs; the static site omits this and
                has no new-run form to land on. The selected variant carries
                through so the run form opens on exactly what is being viewed. */}
            {canExecute && (
              <Link
                className={styles.run}
                to={routes.runNew({
                  slug: testCase.slug,
                  version: testCase.latestVersion,
                  variant: variant.slug,
                })}
              >
                Run ▸
              </Link>
            )}
          </div>
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
      </div>

      {children({ testCase, variant })}
    </PageLayout>
  );
}
