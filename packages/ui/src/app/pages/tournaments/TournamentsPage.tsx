import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Panel } from "@test-cabinet/ui";
import type { TournamentRecord } from "@test-cabinet/run-record";
import { LoadingState } from "../../components/LoadingState";
import { useGalleryData } from "../../data/galleryContext";
import { useControllerName } from "../../data/useControllerName";
import { useTestCaseName } from "../../data/useTestCaseName";
import { routes } from "../../routes";
import styles from "./TournamentsPage.module.scss";

// The Tournaments list body (consoles only): every tournament this host can show,
// newest first, each linking to its standings. Rendered inside the Other section's
// tabbed page (Other → Tournaments), which owns the surrounding chrome; on a host
// without the arena capability it degrades to a "not available here" note. The
// content is factored out here (no page chrome) so the tabbed shell provides the
// header and tab bar around it.
export function TournamentsList() {
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

  if (!arena) {
    return (
      <Panel>
        <p className={styles.empty}>Tournaments are not available here.</p>
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel>
        <p className={styles.empty}>Could not load tournaments: {error}</p>
      </Panel>
    );
  }
  if (loading) {
    return (
      <Panel>
        <LoadingState size="section" label="Loading tournaments…" />
      </Panel>
    );
  }
  if (tournaments.length === 0) {
    return (
      <Panel>
        <p className={styles.empty}>
          No tournaments yet — run one from a case&rsquo;s Arena tab.
        </p>
      </Panel>
    );
  }
  return (
    <ul className={styles.list}>
      {tournaments.map((tournament) => (
        <li key={tournament.id} className={styles.item}>
          <TournamentCard tournament={tournament} />
        </li>
      ))}
    </ul>
  );
}

function TournamentCard({ tournament }: { tournament: TournamentRecord }) {
  const testCaseName = useTestCaseName();
  const controllerName = useControllerName();
  // The leader: the top-ranked controller (rank 1), by model display name.
  const leader = tournament.standings.find((s) => s.rank === 1);
  const leaderRef = leader
    ? tournament.participants.find((p) => p.id === leader.participantId)
    : undefined;
  const leaderLabel = leaderRef
    ? controllerName(leaderRef)
    : (leader?.participantId ?? "—");
  return (
    <Link className={styles.card} to={routes.tournamentDetail(tournament.id)}>
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
        <span className={styles.cardLeader}>Winner: {leaderLabel}</span>
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
