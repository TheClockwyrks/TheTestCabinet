import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Panel } from "@test-cabinet/ui";
import type { MatchSummary, TournamentRecord } from "@test-cabinet/run-record";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useGalleryData, type ArenaApi } from "../../data/galleryContext";
import { useTestCaseName } from "../../data/useTestCaseName";
import { ReplayOverlay } from "../runs/[runId]/AdversarialReplaySection";
import styles from "./TournamentDetailPage.module.scss";

// The Tournament detail page (`/tournaments/:id`): the ranked standings and the
// per-match list, each match's replay viewable on demand. Read through the arena
// capability, so it degrades to a short note on a host without one.
export function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { arena } = useGalleryData();
  const [record, setRecord] = useState<TournamentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!arena || !id) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    arena
      .readTournament(id)
      .then((r) => {
        if (!active) return;
        setRecord(r);
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
  }, [arena, id]);

  return (
    <PageLayout>
      <PromptHeader
        command="--tournament"
        comment={<>// standings &amp; matches</>}
      />
      {!arena ? (
        <Panel>
          <p className={styles.empty}>This tournament is not available here.</p>
        </Panel>
      ) : error ? (
        <Panel>
          <p className={styles.empty}>Could not load the tournament: {error}</p>
        </Panel>
      ) : loading || !record ? (
        <Panel>
          <p className={styles.empty}>Loading tournament…</p>
        </Panel>
      ) : (
        <TournamentBody arena={arena} record={record} />
      )}
    </PageLayout>
  );
}

function TournamentBody({
  arena,
  record,
}: {
  arena: ArenaApi;
  record: TournamentRecord;
}) {
  // The match whose replay overlay is open, by match id (null when none is).
  const [openMatch, setOpenMatch] = useState<MatchSummary | null>(null);
  const testCaseName = useTestCaseName();

  const labelFor = (id: string) =>
    record.participants.find((p) => p.id === id)?.label ?? id;

  const replayUrl =
    openMatch && openMatch.replayKey != null
      ? arena.tournamentReplayUrl(record.id, openMatch.matchId)
      : null;

  return (
    <>
      <p className={styles.caption}>
        {testCaseName(record.testCaseSlug)} {record.testCaseVersion} ·{" "}
        {record.variant}
      </p>

      <section className={styles.section}>
        <h2 className={styles.heading}>Standings</h2>
        <Panel>
          <div
            className={styles.standings}
            role="table"
            aria-label="Tournament standings"
          >
            <div
              className={`${styles.standingsRow} ${styles.head}`}
              role="row"
              aria-hidden="true"
            >
              <span className={styles.rank}>#</span>
              <span>CONTROLLER</span>
              <span className={styles.num}>WINS</span>
              <span className={styles.num}>W–L–D</span>
            </div>
            {record.standings.map((standing) => (
              <div
                className={styles.standingsRow}
                role="row"
                key={standing.participantId}
              >
                <span className={styles.rank}>{standing.rank}</span>
                <span className={styles.controller}>
                  {labelFor(standing.participantId)}
                </span>
                <span className={styles.num}>
                  <span className={styles.wins}>{standing.wins}</span>{" "}
                  <span className={styles.winsUnit}>
                    {standing.wins === 1 ? "win" : "wins"}
                  </span>
                </span>
                <span className={styles.num}>
                  {standing.wins}–{standing.losses}–{standing.draws}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Matches</h2>
        <Panel>
          <div
            className={styles.matches}
            role="table"
            aria-label="Tournament matches"
          >
            <div
              className={`${styles.matchesRow} ${styles.head}`}
              role="row"
              aria-hidden="true"
            >
              <span>MATCH</span>
              <span>WINNER</span>
              <span className={styles.num}>TICKS</span>
              <span className={styles.num}>KILLS</span>
              <span />
            </div>
            {record.matches.map((match) => (
              <MatchRow
                key={match.matchId}
                match={match}
                labelFor={labelFor}
                onReplay={() => setOpenMatch(match)}
              />
            ))}
          </div>
        </Panel>
      </section>

      {openMatch &&
        (replayUrl ? (
          <ReplayOverlay
            label={`Match replay ${openMatch.matchId}`}
            replayUrl={replayUrl}
            onExit={() => setOpenMatch(null)}
          />
        ) : null)}
    </>
  );
}

function MatchRow({
  match,
  labelFor,
  onReplay,
}: {
  match: MatchSummary;
  labelFor: (id: string) => string;
  onReplay: () => void;
}) {
  const winner = match.winner ? labelFor(match.winner) : "Draw";
  // A match decided on efficiency was a level score broken by total fuel; surface
  // the two totals so the verdict is legible rather than mysterious.
  const fuelTitle =
    match.winType === "efficiency"
      ? `total fuel — ${labelFor(match.redId)}: ${match.redFuel.toLocaleString()}, ${labelFor(match.blueId)}: ${match.blueFuel.toLocaleString()}`
      : undefined;
  return (
    <div className={styles.matchesRow} role="row">
      <span className={styles.match}>
        <span className={styles.scoreRed}>{labelFor(match.redId)}</span>
        {" vs "}
        <span className={styles.scoreBlue}>{labelFor(match.blueId)}</span>
      </span>
      <span title={fuelTitle}>
        {winner} · {match.winType}
      </span>
      <span className={styles.num}>{match.ticks}</span>
      <span className={styles.num}>
        {match.redKills}–{match.blueKills}
      </span>
      <span>
        <button
          type="button"
          className={styles.replay}
          onClick={onReplay}
          disabled={match.replayKey == null}
        >
          Replay
        </button>
      </span>
    </div>
  );
}
