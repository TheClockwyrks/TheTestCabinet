import type { SuiteVersionResponse } from "@clockwyrks/run-record/backend-api";
import type { ReactNode } from "react";
import { NavLink, useLocation, useParams } from "react-router";

import styles from "./suite-detail-layout.module.scss";
import { BackChevron } from "../../components/BackChevron";
import { LoadFailureState } from "../../components/LoadFailureState";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { useTestSuiteVersion, useTestSuites } from "../../data/use-test-suites";
import { useSuiteVersion } from "../../pages/testsuites/[slug]/use-suite-version";
import { routes } from "../../routes";

/** The suite detail page's tabs. Each is a distinct route; this drives which tab
 * link reads as active. */
export type SuiteTab =
  | "overview"
  | "specifications"
  | "definitions"
  | "assets"
  | "demonstrations"
  | "references"
  | "changelog";

/** What the layout hands the active tab's body: the resolved suite version and
 * the coordinate it was resolved at. Every tab describes exactly this one
 * version. */
export interface SuiteTabContext {
  /** The suite's slug, which is its directory in the suites checkout. */
  slug: string;
  /** The anchored version folder name, carrying its leading `v`. */
  version: string;
  /** The version's resolved record: every entity the version folder declares. */
  suite: SuiteVersionResponse;
  /** Whether the anchored version is the suite's newest. */
  isNewest: boolean;
}

interface SuiteDetailLayoutProps {
  /** Which tab the rendering page represents. */
  tab: SuiteTab;
  /** The tab body, given the resolved suite version. */
  children: (ctx: SuiteTabContext) => ReactNode;
}

// Shared chrome for every test-suite detail tab: the suite's name, summary and
// tags, the version selector that anchors all tabs at once, and the tab
// navigation over the version's entities. It resolves the suite from the URL
// slug and the version from the query string, owns the loading, load-failure and
// not-found states, and hands the resolved version to the active tab's body —
// the shape `TestCaseDetailLayout` established, so the two detail surfaces read
// as one family.
//
// Two reads stand behind it. The LISTING says which suites exist and which
// versions each holds, which is what decides whether a slug and a version name
// anything at all; the per-version RECORD carries the entities the tabs render.
// The header is drawn from the listing alone, so the suite's identity and its
// version selector are on screen while the record is still in flight.
export function SuiteDetailLayout({ tab, children }: SuiteDetailLayoutProps) {
  const { suiteSlug } = useParams<{ suiteSlug: string }>();
  const { search } = useLocation();
  const listing = useTestSuites();
  const suite = listing.suites.find((entry) => entry.slug === suiteSlug);
  // Called unconditionally (hook rules); with no suite it simply resolves no
  // version, which the guard below turns into the not-found state.
  const coordinate = useSuiteVersion(suite?.versions ?? []);
  const resolved = useTestSuiteVersion(
    suite && coordinate.known ? suite.slug : undefined,
    coordinate.known ? coordinate.version : undefined,
  );

  if (!suite || !coordinate.known) {
    // Three outcomes, three states, exactly as a case detail reports them. While
    // the listing is still being read the suite simply is not resolvable YET; a
    // read that FAILED is reported as a failure, because whether this slug names
    // a suite is precisely what could not be read; "no test suite found" is
    // reserved for a read that settled without one — which is also the answer
    // for a version the suite does not hold.
    const slug = suiteSlug ?? "";
    return (
      <PageLayout>
        <UnresolvedState
          status={listing.status}
          error={listing.error}
          subject={`the test suite “${slug}”`}
          notFound={
            suite
              ? `No version “${coordinate.version}” of the test suite “${slug}”.`
              : `No test suite found for “${slug}”.`
          }
        />
      </PageLayout>
    );
  }

  const identity = coordinate.identity;
  // Tab links carry the current query string so switching tabs preserves the
  // anchored version across the page.
  const tabs: { key: SuiteTab; label: string; to: string }[] = [
    {
      key: "overview",
      label: "Overview",
      to: routes.testSuiteDetail(suite.slug),
    },
    {
      key: "specifications",
      label: "Specifications",
      to: routes.testSuiteSpecifications(suite.slug),
    },
    {
      key: "definitions",
      label: "Test cases",
      to: routes.testSuiteDefinitions(suite.slug),
    },
    { key: "assets", label: "Assets", to: routes.testSuiteAssets(suite.slug) },
    {
      key: "demonstrations",
      label: "Demonstrations",
      to: routes.testSuiteDemos(suite.slug),
    },
    {
      key: "references",
      label: "Reference implementations",
      to: routes.testSuiteReferences(suite.slug),
    },
    {
      key: "changelog",
      label: "Changelog",
      to: routes.testSuiteChangelog(suite.slug),
    },
  ];

  return (
    <PageLayout>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.titleGroup}>
            <BackChevron
              to={routes.testCasesSuites()}
              section="testCases"
              label="All test suites"
            />
            <h1 className={styles.title}>{identity?.name ?? suite.slug}</h1>
            <span className={styles.slug}>{suite.slug}</span>
            {identity?.experimental && (
              <span className={styles.experimental}>Experimental</span>
            )}
          </div>
          <div className={styles.coordinateRow}>
            <VersionControl coordinate={coordinate} />
          </div>
        </div>
        {identity?.summary && (
          <p className={styles.summary}>{identity.summary}</p>
        )}
        {identity && identity.tags.length > 0 && (
          <div className={styles.tags}>
            {identity.tags.map((entry) => (
              <span key={entry} className={styles.tag}>
                {entry}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className={styles.controls}>
        <nav className={styles.tabs} aria-label="Test suite sections">
          {tabs.map((entry) => (
            <NavLink
              key={entry.key}
              to={{ pathname: entry.to, search }}
              className={
                entry.key === tab
                  ? [styles.tab, styles.tabActive].filter(Boolean).join(" ")
                  : styles.tab
              }
            >
              {entry.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {resolved.suite === undefined ? (
        // The version is one the suite holds — the listing said so — so a record
        // that did not arrive is still loading or a failed read, never a missing
        // version.
        <UnresolvedState
          size="section"
          status={resolved.status}
          error={resolved.error}
          subject={`${identity?.name ?? suite.slug} at ${coordinate.version}`}
        />
      ) : (
        children({
          slug: suite.slug,
          version: coordinate.version,
          suite: resolved.suite,
          isNewest: coordinate.isNewest,
        })
      )}
    </PageLayout>
  );
}

// What stands in for a suite or a version that is not resolved: the wait, the
// failed read, or (once the read settled without it) the not-found message.
function UnresolvedState({
  status,
  error,
  subject,
  notFound,
  size = "page",
}: {
  status: "loading" | "ready" | "error";
  error: string | null;
  subject: string;
  notFound?: string;
  size?: "page" | "section";
}) {
  switch (status) {
    case "loading": {
      return <LoadingState size={size} label="Loading test suite…" />;
    }
    case "error": {
      return <LoadFailureState size={size} subject={subject} detail={error} />;
    }
    case "ready": {
      return notFound === undefined ? (
        <LoadFailureState size={size} subject={subject} detail={error} />
      ) : (
        <p className={styles.notFound}>{notFound}</p>
      );
    }
  }
}

// The version selector: a selector when the suite holds more than one version,
// the plain badge otherwise. Labelled the way the case detail's coordinate
// selectors are, so the two headers read alike.
function VersionControl({
  coordinate,
}: {
  coordinate: ReturnType<typeof useSuiteVersion>;
}) {
  return coordinate.versions.length < 2 ? (
    <span className={styles.selector}>
      <span className={styles.selectorLabel}>Version</span>
      <span className={styles.version}>{coordinate.version}</span>
    </span>
  ) : (
    <label className={styles.selector}>
      <span className={styles.selectorLabel}>Version</span>
      <select
        className={styles.versionSelect}
        value={coordinate.version}
        onChange={(event) => {
          coordinate.setVersion(event.target.value);
        }}
      >
        {coordinate.versions.map((entry) => (
          <option key={entry.version} value={entry.version}>
            {entry.version}
          </option>
        ))}
      </select>
    </label>
  );
}
