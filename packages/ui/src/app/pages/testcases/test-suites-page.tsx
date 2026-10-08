import type {
  SuiteOut,
  SuiteVersionIdentity,
} from "@clockwyrks/run-record/backend-api";
import { Link } from "react-router";

import { CatalogTabs } from "./catalog-tabs";
import styles from "./test-suites-page.module.scss";
import { useRecordSectionIndex } from "../../components/backReturn";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useTestSuites } from "../../data/use-test-suites";
import { routes } from "../../routes";

// The Test Cases section's first tab: every test suite the host is served, one
// row apiece. A suite is the authored project test cases are drawn from, so it
// sits beside the catalog's type tabs rather than inside them — the bar above the
// rows is the same `CatalogTabs` the catalog page renders.
//
// A row describes the suite at its NEWEST version (the listing carries a per-
// version identity, and the newest is the one a reader means by "the suite"),
// with every version it holds listed beneath so an older one is one click away.
// Whether a version is offered at all is the deployment's decision — an
// experimental version rides the listing only where the backend opted in — so
// nothing is filtered here; a served experimental version is simply labeled.

/** The version a row describes: the newest the listing carries, which is the last
 * of the `versions` the backend serves oldest first. */
function newestVersion(suite: SuiteOut): SuiteVersionIdentity | undefined {
  return suite.versions.at(-1);
}

export function TestSuitesPage() {
  const { suites, status, error } = useTestSuites();
  // Remember the viewed tab so a suite's detail back-control returns here rather
  // than to the catalog's default tab, exactly as the catalog page does.
  useRecordSectionIndex("testCases");

  // What decides this page's body: the listing it HOLDS, not the last read's
  // outcome — the same data-first order the catalog page renders in. A settled
  // read with nothing in it is a deployment that offers no suites, which is the
  // empty state; a failed re-read over held rows is a notice above them.
  const haveSuites = suites.length > 0 || status === "ready";

  return (
    <PageLayout>
      <PromptHeader
        command="--test-suites"
        blink
        comment={<>// the authored suites test cases are drawn from</>}
      />

      {!haveSuites && status === "loading" && (
        <LoadingState label="Loading test suites…" />
      )}

      {!haveSuites && status === "error" && (
        <p className={styles.error}>
          Couldn&apos;t reach the backend, so the test suites are unavailable.
        </p>
      )}

      {haveSuites && (
        <>
          {status === "error" && (
            <p className={styles.error} role="alert">
              Couldn&apos;t reach the backend, so this list may be out of date.
              {error !== null && ` (${error})`}
            </p>
          )}
          <div className={styles.controls}>
            <CatalogTabs active="suites" />
          </div>

          {suites.length === 0 ? (
            <p className={styles.empty}>
              This deployment offers no test suites.
            </p>
          ) : (
            <ul className={styles.list}>
              {suites.map((suite) => (
                <SuiteRow key={suite.slug} suite={suite} />
              ))}
            </ul>
          )}
        </>
      )}
    </PageLayout>
  );
}

// One suite: its name, slug, newest version and experimental marker on the first
// row, then that version's summary and tags, then every version it holds. The
// name and each version open the suite's detail surface, the version ones
// anchored to the version they name.
function SuiteRow({ suite }: { suite: SuiteOut }) {
  const newest = newestVersion(suite);
  // A suite with no visible version is never served (the backend omits it with
  // its versions), so this is only the shape a row degrades to rather than a
  // state a deployment produces.
  if (newest === undefined) return null;
  // Newest first for the reader; the wire order is oldest first.
  const versions = reversed(suite.versions);
  return (
    <li className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.name}>
          <Link to={routes.testSuiteDetail(suite.slug)}>{newest.name}</Link>
        </h2>
        <span className={styles.slug}>{suite.slug}</span>
        <span className={styles.version}>{newest.version}</span>
        {newest.experimental && (
          <span className={styles.experimental}>Experimental</span>
        )}
      </div>
      {newest.summary && <p className={styles.summary}>{newest.summary}</p>}
      {newest.tags.length > 0 && (
        <ul className={styles.tags}>
          {newest.tags.map((tag) => (
            <li key={tag} className={styles.tag}>
              {tag}
            </li>
          ))}
        </ul>
      )}
      <ul className={styles.versions}>
        <li className={styles.versionsLabel}>Versions</li>
        {versions.map((version) => (
          <li key={version.version}>
            <Link
              className={styles.versionLink}
              to={routes.testSuiteDetail(suite.slug, version.version)}
            >
              {version.version}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

// `items` newest first, given oldest first: a reversed copy, leaving the
// caller's array as it was.
function reversed<T>(items: readonly T[]): T[] {
  const out: T[] = [];
  for (const item of items) out.unshift(item);
  return out;
}
