import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Panel } from "@test-cabinet/ui";
import type { TournamentRecord } from "@test-cabinet/run-record";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useGalleryData } from "../../data/galleryContext";
import { useTestCaseName } from "../../data/useTestCaseName";
import { routes } from "../../routes";
import styles from "./TournamentsPage.module.scss";

// The Tournaments list (`/tournaments`, consoles only): every tournament this
// host can show, newest first, each linking to its standings. Hidden entirely on
// a host without the arena capability (the static site never routes here).
export function TournamentsPage() {
  const { arena } = useGalleryData();
  const [tournaments, setTournaments] = useState<TournamentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!arena) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    arena
      .listTournaments()
      .then((ts) => {
        if (!active) return;
        setTournaments(ts);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [arena]);

  return (
    <PageLayout>
      <PromptHeader command="--tournaments" comment={<>// adversarial standings</>} />

      {!arena ? (
        <Panel>
          <p className={styles.empty}>Tournaments are not available here.</p>
        </Panel>
      ) : error ? (
        <Panel>
          <p className={styles.empty}>Could not load tournaments: {error}</p>
        </Panel>
      ) : loading ? (
        <Panel>
          <p className={styles.empty}>Loading tournaments…</p>
        </Panel>
      ) : tournaments.length === 0 ? (
        <Panel>
          <p className={styles.empty}>
            No tournaments yet — run one from a case&rsquo;s Arena tab.
          </p>
        </Panel>
      ) : (
        <ul className={styles.list}>
          {tournaments.map((tournament) => (
            <li key={tournament.id} className={styles.item}>
              <TournamentCard tournament={tournament} />
            </li>
          ))}
        </ul>
      )}
    </PageLayout>
  );
}

function TournamentCard({ tournament }: { tournament: TournamentRecord }) {
  const testCaseName = useTestCaseName();
  // The leader: the top-ranked controller (rank 1), labelled where possible.
  const leader = tournament.standings.find((s) => s.rank === 1);
  const leaderRef = leader
    ? tournament.participants.find((p) => p.id === leader.participantId)
    : undefined;
  const leaderLabel = leaderRef?.label ?? leader?.participantId ?? "—";
  return (
    <Link
      className={styles.card}
      to={routes.tournamentDetail(tournament.id)}
    >
      <div className={styles.cardMain}>
        <span className={styles.cardCase}>
          {testCaseName(tournament.testCaseSlug)} {tournament.testCaseVersion}
        </span>
        <span className={styles.cardMeta}>
          {tournament.participants.length} controllers ·{" "}
          {tournament.matches.length} matches
        </span>
      </div>
      <div className={styles.cardSide}>
        <span className={styles.cardLeader}>{leaderLabel}</span>
        <span className={styles.cardDate}>
          {formatDate(tournament.createdAt)}
        </span>
      </div>
    </Link>
  );
}

// Render an RFC 3339 timestamp as a short local date, or the raw value if it
// cannot be parsed.
function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}
