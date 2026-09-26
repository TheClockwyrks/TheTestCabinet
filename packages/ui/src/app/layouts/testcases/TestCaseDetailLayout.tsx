import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useParams } from "react-router";
import { Panel } from "@clockwyrks/ui";
import { PageLayout } from "../../components/PageLayout";
import { LoadingState } from "../../components/LoadingState";
import { LoadFailureState } from "../../components/LoadFailureState";
import { BackChevron } from "../../components/BackChevron";
import { useGalleryData } from "../../data/galleryContext";
import { useTestCase } from "../../data/useTestCase";
import { tabOf } from "../../data/testCaseTabs";
import { hasReferencePlayback } from "../../data/testCaseReference";
import { DEFAULT_ENGINE_SLUG, engineName } from "../../data/engines";
import type { TestCaseDetail, VariantSummary } from "../../data/testCases";
import { useCaseVariant } from "../../data/useRunVariant";
import { routes } from "../../routes";
import {
  useSelectedCoordinate,
  type SelectedCoordinate,
} from "../../pages/testcases/[slug]/useSelectedCoordinate";
import styles from "./TestCaseDetailLayout.module.scss";

// The detail page's tabs. Each is a distinct route; this drives which tab link
// reads as active.
export type DetailTab =
  | "overview"
  | "inputs"
  | "reviewing"
  | "runs"
  | "leaderboard"
  | "metrics"
  | "changelog"
  | "errata"
  | "arena"
  | "reference";

/** What the layout hands the active tab's body: the case, the anchored
 * coordinate, and the coordinate's resolved variant. */
export interface DetailTabContext {
  testCase: TestCaseDetail;
  /** The anchored version — what every tab describes. */
  version: string;
  /** The anchored engine (`none` for the engineless rendering). */
  engine: string;
  /** Whether the anchored version is the case's latest. */
  isLatest: boolean;
  /** The anchored variant of the anchored version, rendered for the anchored
   * engine — resolved through the same `fetchCaseVariant` a run's Inputs tab
   * uses, so its prompt, seeded inputs, checklist and reference belong to
   * exactly the selected coordinate. */
  variant: VariantSummary;
}

/** {@link DetailTabContext} without the resolved variant — what a
 * coordinate-free tab (Overview, Changelog, Errata) renders from. */
export type CoordinateFreeTabContext = Omit<DetailTabContext, "variant">;

interface TestCaseDetailLayoutProps {
  /** Which tab the rendering page represents. */
  tab: DetailTab;
  /** The tab body, given the resolved case and the anchored coordinate. */
  children: (ctx: DetailTabContext) => ReactNode;
  /** For a tab whose content does not depend on the resolved coordinate
   * (Overview, Changelog, Errata cover every version regardless of the anchor):
   * the same body, rendered even when this host cannot resolve the coordinate —
   * whole-history data must not become unreachable behind a rendering the host
   * does not carry. */
  fallback?: (ctx: CoordinateFreeTabContext) => ReactNode;
}

// Shared chrome for every test-case detail tab: the title and metadata, the
// page-level coordinate selectors (version, variant, engine) that anchor all
// tabs at once, and the tab navigation. It resolves the case from the URL slug,
// the coordinate from the query string, and the coordinate's variant through the
// shared per-(version, variant, engine) resolver, then hands all of it to the
// active tab's body. Resolving (and the not-found state) lives here so the tab
// pages stay thin and never duplicate it.
export function TestCaseDetailLayout({
  tab,
  children,
  fallback,
}: TestCaseDetailLayoutProps) {
  const { slug } = useParams<{ slug: string }>();
  const { search } = useLocation();
  const { canExecute, arena } = useGalleryData();
  // The detail tabs need the whole case — its versions, variants, description,
  // changelog, and errata — which the catalog listing deliberately does not
  // carry. Fetch the one case this route is about rather than making every
  // listing pay for all of them.
  const { testCase, status } = useTestCase(slug);
  // Called unconditionally (hook rules); it tolerates an undefined case and
  // simply resolves no coordinate, which the guard below turns into the loading
  // or not-found state.
  const coordinate = useSelectedCoordinate(testCase);
  // The anchored coordinate's variant in full. While the case itself is still
  // resolving the coordinate is blank and this stays `loading`.
  const resolved = useCaseVariant(
    testCase?.slug ?? "",
    coordinate.version,
    coordinate.variant?.slug ?? "",
    coordinate.engine,
  );

  if (!testCase || !coordinate.variant) {
    // Three outcomes, three states. While the case is still being fetched it
    // simply isn't resolvable YET, so show the branded full-body loading state
    // (the topbar stays). A fetch that FAILED is reported as a failure: whether
    // this slug names a case is precisely what could not be read. "No test case
    // found" is reserved for a fetch that settled without one.
    return (
      <PageLayout>
        {status === "loading" ? (
          <LoadingState label="Loading test case…" />
        ) : status === "error" ? (
          <LoadFailureState subject={`the test case “${slug}”`} />
        ) : (
          <p className={styles.notFound}>
            No test case found for &ldquo;{slug}&rdquo;.
          </p>
        )}
      </PageLayout>
    );
  }

  // The landing tab is the case's Play surface whenever the anchored
  // coordinate has something to play — an authored showcase carousel or a
  // published reference build — and stays the plain Overview description
  // otherwise. Only the LABEL follows the coordinate; the tab id and route
  // stay "overview" at /test-cases/:slug, so links and the active-tab logic
  // never move.
  const playable =
    resolved.variant !== undefined &&
    ((resolved.variant.showcase?.media.length ?? 0) > 0 ||
      Object.keys(resolved.variant.referenceBuilds).length > 0);
  // Tab links carry the current query string so switching tabs preserves the
  // anchored coordinate (and any scope widening) across the page.
  const tabs: { key: DetailTab; label: string; to: string }[] = [
    {
      key: "overview",
      label: playable ? "Play" : "Overview",
      to: routes.testCaseDetail(testCase.slug),
    },
    {
      key: "inputs",
      label: "Inputs",
      to: routes.testCaseInputs(testCase.slug),
    },
    {
      key: "reviewing",
      label: "Reviewing",
      to: routes.testCaseReviewing(testCase.slug),
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
  // The Errata tab is shown only when a version of the case actually records known
  // issues. Errata are appended to a shipped version after the fact, so most cases
  // carry none — hiding the empty tab keeps the nav uncluttered (the page itself
  // still degrades to an empty state if reached directly).
  if (testCase.errata.length > 0) {
    tabs.push({
      key: "errata",
      label: "Errata",
      to: routes.testCaseErrata(testCase.slug),
    });
  }
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
  // The Reference tab is shown for either of the two reference shapes that still
  // earn a tab of their own. Neither is a superset of the other:
  //
  //   • `referenceSheet` — the published reference FRAMES (asset-generation cases),
  //     which have no page to embed and so are rendered natively from the snapshot
  //     bucket.
  //   • a bundled reference PLAYBACK (the performance case), whose reference is its
  //     scored factories stepped through the authoritative engine — see
  //     `hasReferencePlayback`.
  //
  // A deployed reference BUILD (`referenceBuilds`) no longer earns its own tab: it
  // folds into the landing tab's Play surface, whose label above already advertises
  // it.
  //
  // The sheet keys off the ANCHORED coordinate, because a reference is published per
  // (version, variant) — switching either adds or removes the tab, and while the
  // coordinate is still resolving the tab is simply not offered yet (the strip below
  // renders only once the resolution settles). The playback keys off the CASE,
  // because it ships with the UI bundle rather than being published per coordinate,
  // so every host can show it — no console-only capability is required. A case with
  // neither (the common case) shows no tab at all.
  if (resolved.variant?.referenceSheet || hasReferencePlayback(testCase)) {
    tabs.push({
      key: "reference",
      label: "Reference",
      to: routes.testCaseReference(testCase.slug),
    });
  }

  return (
    <PageLayout>
      {/* Two rows spanning the content width: the title with its difficulty
          rating against the version selector and the Run action, then the tags
          against the engine and variant selectors. */}
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.titleGroup}>
            {/* Back returns to the tab the user came from; on a fresh deep link
                (nothing recorded) it falls back to this case's own type tab
                rather than the catalog default. */}
            <BackChevron
              to={
                tabOf(testCase)
                  ? routes.testCasesCatalog(tabOf(testCase)!)
                  : routes.testCases()
              }
              section="testCases"
              label="All test cases"
            />
            <h1 className={styles.title}>{testCase.name}</h1>
            <span
              className={styles.difficulty}
              data-level={testCase.difficulty}
            >
              {testCase.difficulty}
            </span>
          </div>
          {/* The coordinate selectors live in the header (not the tab strip):
              they anchor every tab at once. The version leads, on the title's
              line beside the Run action; the engine and variant follow on the
              second row. All read as one labelled family. */}
          <div className={styles.coordinateRow}>
            <VersionControl coordinate={coordinate} />
            {/* Only the consoles can launch runs; the static site omits this
                and has no new-run form to land on. The whole anchored
                coordinate carries through so the run form opens on exactly
                what is being viewed. Keeping the action here leaves the tab
                strip a clean single row that reads like the run and model
                detail strips. */}
            {canExecute && (
              <Link
                className={styles.run}
                to={routes.runNew({
                  slug: testCase.slug,
                  version: coordinate.version,
                  variant: coordinate.variant.slug,
                  engine:
                    coordinate.engine === DEFAULT_ENGINE_SLUG
                      ? undefined
                      : coordinate.engine,
                })}
              >
                Run ▸
              </Link>
            )}
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
          <div className={styles.coordinateRow}>
            {/* The engine selector appears only when the anchored version
                supports a choice — most cases are engineless and read as they
                would without the dimension. */}
            {coordinate.engines.length > 1 && (
              <label className={styles.variant}>
                <span className={styles.variantLabel}>Engine</span>
                <select
                  className={styles.variantSelect}
                  value={coordinate.engine}
                  onChange={(event) => coordinate.setEngine(event.target.value)}
                >
                  {coordinate.engines.map((entry) => (
                    <option key={entry} value={entry}>
                      {engineName(entry)}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
      </header>

      {resolved.status === "loading" ? (
        // The tab strip waits with the body: which tabs exist (Reference) is a
        // fact about the resolved coordinate, and the resolution is one cached
        // fetch — a settled state follows promptly.
        <LoadingState size="section" label="Loading test case…" />
      ) : (
        <>
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
          <VersionNotice coordinate={coordinate} />
          {resolved.variant ? (
            children({
              testCase,
              version: coordinate.version,
              engine: coordinate.engine,
              isLatest: coordinate.isLatest,
              variant: resolved.variant,
            })
          ) : fallback ? (
            // A coordinate-free tab covers every version regardless of the
            // anchor, so an unresolvable coordinate must not take it hostage.
            fallback({
              testCase,
              version: coordinate.version,
              engine: coordinate.engine,
              isLatest: coordinate.isLatest,
            })
          ) : (
            <CoordinateUnavailable
              name={coordinate.variant.name}
              version={coordinate.version}
              engine={coordinate.engine}
              failed={resolved.status === "error"}
              retry={resolved.retry}
            />
          )}
        </>
      )}
    </PageLayout>
  );
}

// The body shown when the anchored coordinate has no resolution behind it. A
// failed fetch and a host that genuinely lacks the rendering are different
// facts: only the failure offers a retry, and only the miss is stated as one.
// The header above stays interactive either way, so the visitor can also
// select their way back out.
function CoordinateUnavailable({
  name,
  version,
  engine,
  failed,
  retry,
}: {
  name: string;
  version: string;
  engine: string;
  failed: boolean;
  retry: () => void;
}) {
  return (
    <Panel>
      <p className={styles.notFound}>
        {failed
          ? `Couldn't load ${name} at ${version} on ${engineName(engine)}.`
          : `This host cannot show ${name} at ${version} on ${engineName(engine)}.`}
      </p>
      {failed && (
        <button type="button" className={styles.retry} onClick={retry}>
          Retry
        </button>
      )}
    </Panel>
  );
}

// The version selector, labelled like the variant and engine selectors it sits
// beside: a selector when the case has more than one published version, the
// plain badge otherwise. It does not itself mark a superseded selection — the
// VersionNotice under the tab strip does. Shared with the game-jam detail
// layout, which mirrors this header.
export function VersionControl({
  coordinate,
}: {
  coordinate: SelectedCoordinate;
}) {
  if (coordinate.versions.length < 2) {
    return (
      <span className={styles.variant}>
        <span className={styles.variantLabel}>Version</span>
        <span className={styles.version}>{coordinate.version}</span>
      </span>
    );
  }
  return (
    <label className={styles.variant}>
      <span className={styles.variantLabel}>Version</span>
      <select
        className={`${styles.variantSelect} ${styles.versionSelect}`}
        value={coordinate.version}
        onChange={(event) => coordinate.setVersion(event.target.value)}
      >
        {coordinate.versions.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </select>
    </label>
  );
}

// The line between the tab strip and the tab body while the page is anchored to
// a superseded version: which version is being viewed, and a link to the latest
// one. A superseded selection is legitimate — its runs were judged against it —
// but reading an old deliverable must never masquerade as the current one. The
// link carries the same query string the selector would write, so the two land
// on the same coordinate. Nothing renders on the latest version. Shared with the
// game-jam detail layout.
export function VersionNotice({
  coordinate,
}: {
  coordinate: SelectedCoordinate;
}) {
  if (coordinate.isLatest) return null;
  const latest = coordinate.latestVersion;
  return (
    <p className={styles.versionNotice}>
      Viewing {coordinate.version}; latest is{" "}
      <Link to={{ search: coordinate.searchForVersion(latest) }}>{latest}</Link>
    </p>
  );
}
