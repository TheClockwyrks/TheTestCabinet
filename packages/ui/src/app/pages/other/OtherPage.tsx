import { useMemo } from "react";
import { Link, NavLink } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { LoadingState } from "../../components/LoadingState";
import { PromptHeader } from "../../components/PromptHeader";
import { useRecordSectionIndex } from "../../components/backReturn";
import { useGalleryData } from "../../data/galleryContext";
import type { TestCaseSummary } from "../../data/testCases";
import { useTestCases } from "../../data/useTestCases";
import { routes } from "../../routes";
import { TournamentsList } from "../tournaments/TournamentsPage";
// The Other page reuses the Test Cases page's tab-bar and list-card styles so the
// two catalog-style surfaces read identically.
import styles from "../testcases/TestCasesPage.module.scss";

// The "Other" section's tabs, in display order. Each is its own route so the
// selection is in the URL and survives a reload. (Comparisons moved to the Runs
// section's Comparisons tab, where they render on the public site too.)
export type OtherTab = "game-jams" | "tournaments";

/** What this host can list under the section's tabs — the inputs `hasEntries`
 *  reads, gathered once so a tab's visibility is decided in one place. */
interface OtherHost {
  /** The game-jam cases the catalog holds. */
  jams: TestCaseSummary[];
  /** Whether the host carries the arena capability tournaments are read through.
   *  Without it there is no tournament to list — and, on the static site, no
   *  Tournaments route mounted either. */
  hasArena: boolean;
}

const OTHER_TABS: ReadonlyArray<{
  tab: OtherTab;
  label: string;
  to: string;
  /** Whether this host has anything to show under the tab. Consulted only off a
   *  console (see `visibleTabs`). */
  hasEntries: (host: OtherHost) => boolean;
}> = [
  {
    tab: "game-jams",
    label: "Game Jams",
    to: routes.otherGameJams(),
    hasEntries: (host) => host.jams.length > 0,
  },
  {
    tab: "tournaments",
    label: "Tournaments",
    to: routes.otherTournaments(),
    hasEntries: (host) => host.hasArena,
  },
];

interface OtherPageProps {
  /** Which tab this route renders. Carried in the URL (one route per tab) so the
   * selection survives a reload and is linkable. */
  tab: OtherTab;
}

// The "Other" section (consoles only): a tabbed page collecting the surfaces that
// don't belong on the Test Cases catalog — Game Jams (jam cases, presented on
// their own pages) and Tournaments (the arena standings list). The tab bar mirrors
// the Test Cases page; the bare `/other` redirects to the first tab.
export function OtherPage({ tab }: OtherPageProps) {
  const { canExecute, arena } = useGalleryData();
  const { testCases, status } = useTestCases();
  // Record the viewed tab so a jam or tournament detail page's back chevron
  // returns here rather than to the section default.
  useRecordSectionIndex("other");

  // Jams are excluded from the Test Cases catalog and surface only here. Listed
  // alphabetically, never ranked.
  const jams = useMemo(
    () =>
      testCases
        .filter((testCase) => testCase.testType === "game-jam")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [testCases],
  );

  // Mirrors the Test Cases page's tab bar: a console shows every tab regardless
  // of what it currently holds, so the bar's shape is stable even for a surface
  // with nothing under it yet; elsewhere (the static gallery site) a tab with no
  // entries is hidden, so the bar advertises only what this host can actually
  // list.
  const visibleTabs = useMemo(
    () =>
      canExecute
        ? OTHER_TABS
        : OTHER_TABS.filter((entry) =>
            entry.hasEntries({ jams, hasArena: arena != null }),
          ),
    [canExecute, jams, arena],
  );

  return (
    <PageLayout>
      <PromptHeader
        command={tab === "game-jams" ? "--game-jams" : "--tournaments"}
        comment={
          tab === "game-jams" ? (
            <>// themed jams &amp; their entries</>
          ) : (
            <>// adversarial standings</>
          )
        }
      />

      <div className={styles.controls}>
        <nav className={styles.tabs} aria-label="Other sections">
          {visibleTabs.map((entry) => (
            <NavLink
              key={entry.tab}
              to={entry.to}
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
      </div>

      {tab === "game-jams" ? (
        <GameJamsList
          jams={jams}
          status={status}
          // Whether a catalog is resolved at all, which is what decides the body
          // below — not the last read's outcome. A catalog kept across a failed
          // re-read still lists its jams.
          haveCatalog={testCases.length > 0 || status === "ready"}
        />
      ) : (
        <TournamentsList />
      )}
    </PageLayout>
  );
}

// The Game Jams list: every game-jam case as a full-width card (name, summary,
// tags), linking to its own detail page. The jams come from the catalog data
// pipeline (`useTestCases`) filtered to the game-jam type — resolved by the page
// above, which needs the same set to decide whether the tab shows at all. A jam
// isn't tiered, so — unlike a test-case card — there is no difficulty badge; the
// theme reads through the tags.
function GameJamsList({
  jams,
  status,
  haveCatalog,
}: {
  jams: TestCaseSummary[];
  status: ReturnType<typeof useTestCases>["status"];
  haveCatalog: boolean;
}) {
  // Render order: the catalog this list HAS decides, and the read state only
  // speaks when there is none. A catalog kept across a failed re-read lists its
  // jams with the failure said above them; "No game jams yet" is reserved for a
  // catalog that resolved and holds none.
  if (!haveCatalog) {
    return status === "loading" ? (
      <LoadingState label="Loading catalog…" />
    ) : (
      <p className={styles.error}>
        Couldn&apos;t reach the backend, so the game-jam catalog is unavailable.
      </p>
    );
  }

  const stale = status === "error" && (
    <p className={styles.error} role="alert">
      Couldn&apos;t reach the backend, so this catalog may be out of date.
    </p>
  );

  if (jams.length === 0) {
    return (
      <>
        {stale}
        <p className={styles.empty}>No game jams yet.</p>
      </>
    );
  }

  return (
    <>
      {stale}
      <ul className={styles.list}>
        {jams.map((jam) => (
          <li key={jam.slug}>
            <Link to={routes.gameJamDetail(jam.slug)} className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>{jam.name}</h2>
              </div>
              {jam.summary && <p className={styles.summary}>{jam.summary}</p>}
              {jam.tags.length > 0 && (
                <ul className={styles.tags}>
                  {jam.tags.map((value) => (
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
    </>
  );
}
