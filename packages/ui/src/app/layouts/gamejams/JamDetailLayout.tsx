import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useParams } from "react-router";
import { Panel } from "@clockwyrks/ui";
import { PageLayout } from "../../components/PageLayout";
import { LoadingState } from "../../components/LoadingState";
import { BackChevron } from "../../components/BackChevron";
import { useGalleryData } from "../../data/galleryContext";
import { useTestCase } from "../../data/useTestCase";
import { engineName } from "../../data/engines";
import { useCaseVariant } from "../../data/useRunVariant";
import { routes } from "../../routes";
import { useSelectedCoordinate } from "../../pages/testcases/[slug]/useSelectedCoordinate";
import {
  VersionControl,
  type CoordinateFreeTabContext,
  type DetailTabContext,
} from "../testcases/TestCaseDetailLayout";
// A game jam shares the catalog data pipeline (and so the detail chrome) with a
// test case; it reuses the test-case detail styles so the two read identically.
import styles from "../testcases/TestCaseDetailLayout.module.scss";

// The game-jam detail page's tabs — the test-case set minus Changelog, Reference,
// and Arena (a jam declares none). Each is a distinct route; this drives which
// tab link reads as active.
export type JamDetailTab =
  | "overview"
  | "inputs"
  | "runs"
  | "leaderboard"
  | "metrics";

interface JamDetailLayoutProps {
  /** Which tab the rendering page represents. */
  tab: JamDetailTab;
  /** The tab body, given the resolved jam and the anchored coordinate. */
  children: (ctx: DetailTabContext) => ReactNode;
  /** For a tab whose content does not depend on the resolved coordinate: the
   * same body, rendered even when this host cannot resolve the coordinate (see
   * {@link TestCaseDetailLayout}). */
  fallback?: (ctx: CoordinateFreeTabContext) => ReactNode;
}

// Shared chrome for every game-jam detail tab: the title and metadata, the
// page-level coordinate selectors that anchor all tabs at once, and the tab
// navigation. Mirrors {@link TestCaseDetailLayout}, resolving the jam from the
// URL slug and the coordinate from the query string, but omits the difficulty
// badge (a jam isn't tiered — its theme reads through the tags instead) and the
// extra tabs a jam has no data for. A jam is engineless, so the engine selector
// never has a choice to offer and is left off.
export function JamDetailLayout({
  tab,
  children,
  fallback,
}: JamDetailLayoutProps) {
  const { slug } = useParams<{ slug: string }>();
  const { search } = useLocation();
  const { canExecute } = useGalleryData();
  // Like the test-case detail layout, the jam tabs need the whole case, so the
  // one jam this route is about is fetched rather than carried in the listing.
  const { testCase: resolvedCase, status } = useTestCase(slug);
  // Only a game jam is reachable here; a slug that resolves to some other test
  // type is treated as not found so a jam URL can't surface a non-jam case.
  const testCase =
    resolvedCase?.testType === "game-jam" ? resolvedCase : undefined;
  // Called unconditionally (hook rules); it tolerates an undefined case and
  // simply resolves no coordinate, which the guard below turns into the loading
  // or not-found state.
  const coordinate = useSelectedCoordinate(testCase);
  const resolved = useCaseVariant(
    testCase?.slug ?? "",
    coordinate.version,
    coordinate.variant?.slug ?? "",
    coordinate.engine,
  );

  if (!testCase || !coordinate.variant) {
    // While the jam is still being fetched it isn't resolvable yet, so show the
    // branded full-body loading state (the topbar stays) rather than the
    // not-found text, which is reserved for a jam genuinely absent once the
    // fetch has settled.
    return (
      <PageLayout>
        {status === "loading" ? (
          <LoadingState label="Loading game jam…" />
        ) : (
          <p className={styles.notFound}>
            No game jam found for &ldquo;{slug}&rdquo;.
          </p>
        )}
      </PageLayout>
    );
  }

  // Tab links carry the current query string so switching tabs preserves the
  // anchored coordinate (and any scope widening).
  const tabs: { key: JamDetailTab; label: string; to: string }[] = [
    {
      key: "overview",
      label: "Overview",
      to: routes.gameJamDetail(testCase.slug),
    },
    { key: "inputs", label: "Inputs", to: routes.gameJamInputs(testCase.slug) },
    { key: "runs", label: "Runs", to: routes.gameJamRuns(testCase.slug) },
    {
      key: "leaderboard",
      label: "Leaderboard",
      to: routes.gameJamLeaderboard(testCase.slug),
    },
    {
      key: "metrics",
      label: "Metrics",
      to: routes.gameJamMetrics(testCase.slug),
    },
  ];

  return (
    <PageLayout>
      {/* Two rows spanning the content width: the title against the coordinate
          selectors (version, variant), then the tags against the Run action. A
          jam isn't tiered, so — unlike the test-case header — there is no
          difficulty badge; the theme reads through the tags. */}
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.titleGroup}>
            {/* Back returns to the Other tab the user came from; on a fresh deep
                link (nothing recorded) it falls back to the Game Jams tab, which
                is where a jam is listed. */}
            <BackChevron
              to={routes.otherGameJams()}
              section="other"
              label="All game jams"
            />
            <h1 className={styles.title}>{testCase.name}</h1>
          </div>
          <div className={styles.coordinateRow}>
            <VersionControl coordinate={coordinate} />
            <label className={styles.variant}>
              <span className={styles.variantLabel}>Variant</span>
              <select
                className={styles.variantSelect}
                value={coordinate.variant.slug}
                onChange={(event) => coordinate.setVariant(event.target.value)}
              >
                {coordinate.variants.map((entry) => (
                  <option key={entry.slug} value={entry.slug}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className={styles.metaRow}>
          <div className={styles.tags}>
            {testCase.tags.map((entry) => (
              <span key={entry} className={styles.tag}>
                {entry}
              </span>
            ))}
          </div>
          {/* Only the consoles can launch runs; the anchored coordinate
              carries through so the run form opens on exactly what is being
              viewed. */}
          {canExecute && (
            <Link
              className={styles.run}
              to={routes.runNew({
                slug: testCase.slug,
                version: coordinate.version,
                variant: coordinate.variant.slug,
              })}
            >
              Run ▸
            </Link>
          )}
        </div>
      </header>

      {resolved.status === "loading" ? (
        <LoadingState size="section" label="Loading game jam…" />
      ) : (
        <>
          <div className={styles.controls}>
            <nav className={styles.tabs} aria-label="Game jam sections">
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
          {resolved.variant ? (
            children({
              testCase,
              version: coordinate.version,
              engine: coordinate.engine,
              isLatest: coordinate.isLatest,
              variant: resolved.variant,
            })
          ) : fallback ? (
            fallback({
              testCase,
              version: coordinate.version,
              engine: coordinate.engine,
              isLatest: coordinate.isLatest,
            })
          ) : (
            // A failed fetch and a host that genuinely lacks the rendering are
            // different facts: only the failure offers a retry, and only the
            // miss is stated as one. The header stays interactive either way.
            <Panel>
              <p className={styles.notFound}>
                {resolved.status === "error"
                  ? `Couldn't load ${coordinate.variant.name} at ${coordinate.version} on ${engineName(coordinate.engine)}.`
                  : `This host cannot show ${coordinate.variant.name} at ${coordinate.version} on ${engineName(coordinate.engine)}.`}
              </p>
              {resolved.status === "error" && (
                <button
                  type="button"
                  className={styles.retry}
                  onClick={resolved.retry}
                >
                  Retry
                </button>
              )}
            </Panel>
          )}
        </>
      )}
    </PageLayout>
  );
}
