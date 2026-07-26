import { useMemo } from "react";
import { Link, NavLink } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { LoadingState } from "../../components/LoadingState";
import { PromptHeader } from "../../components/PromptHeader";
import { useTestCases } from "../../data/useTestCases";
import { routes } from "../../routes";
import { TournamentsList } from "../tournaments/TournamentsPage";
// The Other page reuses the Test Cases page's tab-bar and list-card styles so the
// two catalog-style surfaces read identically.
import styles from "../testcases/TestCasesPage.module.scss";

// The "Other" section's two tabs, in display order. Each is its own route so the
// selection is in the URL and survives a reload.
export type OtherTab = "game-jams" | "tournaments";

const OTHER_TABS: ReadonlyArray<{ tab: OtherTab; label: string; to: string }> = [
  { tab: "game-jams", label: "Game Jams", to: routes.otherGameJams() },
  { tab: "tournaments", label: "Tournaments", to: routes.otherTournaments() },
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
          {OTHER_TABS.map((entry) => (
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

      {tab === "game-jams" ? <GameJamsList /> : <TournamentsList />}
    </PageLayout>
  );
}

// The Game Jams list: every game-jam case as a full-width card (name, summary,
// tags), linking to its own detail page. Reuses the catalog data pipeline
// (`useTestCases`), filtered to the game-jam type — jams are excluded from the
// Test Cases catalog and surface only here. Listed alphabetically, never ranked
// (a jam isn't tiered, so — unlike a test-case card — there is no difficulty
// badge; the theme reads through the tags).
function GameJamsList() {
  const { testCases, status } = useTestCases();

  const jams = useMemo(
    () =>
      testCases
        .filter((testCase) => testCase.testType === "game-jam")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [testCases],
  );

  if (status === "loading") {
    return <LoadingState label="Loading catalog…" />;
  }
  if (status === "error") {
    return (
      <p className={styles.error}>
        Couldn&apos;t reach the backend — the game-jam catalog is unavailable.
      </p>
    );
  }
  if (jams.length === 0) {
    return <p className={styles.empty}>No game jams yet.</p>;
  }

  return (
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
  );
}
