import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Panel } from "@test-cabinet/ui";
import type {
  MatchSummary,
  Standing,
  TournamentRecord,
} from "@test-cabinet/run-record";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { BackChevron } from "../../components/BackChevron";
import { useControllerName } from "../../data/useControllerName";
import { useGalleryData, type ArenaApi } from "../../data/galleryContext";
import { useTestCaseName } from "../../data/useTestCaseName";
import { routes } from "../../routes";
import { ReplayOverlay } from "../runs/[runId]/AdversarialReplaySection";
import styles from "./TournamentDetailPage.module.scss";

// The Tournament detail page (`/tournaments/:id`): the ranked standings and the
// per-match list, each match's replay viewable on demand. Read through the arena
// capability, so it degrades to a short note on a host without one.
export function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { arena } = useGalleryData();
  const testCaseName = useTestCaseName();
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
      {/* The subject line is this page's title, so the back chevron sits beside
          it as it does on the test-case, jam, run, and model detail pages. It is
          rendered in every state — including while loading and where the arena
          is unavailable — so a deep link can always get back to the list. */}
      <div className={styles.titleRow}>
        <BackChevron
          to={routes.otherTournaments()}
          section="other"
          label="All tournaments"
        />
        <h1 className={styles.caption}>
          {record
            ? `${testCaseName(record.testCaseSlug)} ${record.testCaseVersion} · ${record.variant}`
            : "Tournament"}
        </h1>
      </div>
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
          <LoadingState size="section" label="Loading tournament…" />
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
  const controllerName = useControllerName();

  const labelFor = (id: string) => {
    const participant = record.participants.find((p) => p.id === id);
    return participant ? controllerName(participant) : id;
  };

  const replayUrl =
    openMatch && openMatch.replayKey != null
      ? arena.tournamentReplayUrl(record.id, openMatch.matchId)
      : null;

  return (
    <>
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
              <span className={styles.caret} />
              <span className={styles.rank}>#</span>
              <span>CONTROLLER</span>
              <span className={styles.num}>WINS</span>
              <span className={styles.num}>W–L–D</span>
            </div>
            {record.standings.map((standing) => (
              <StandingRow
                key={standing.participantId}
                standing={standing}
                matches={record.matches}
                labelFor={labelFor}
              />
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
              <span className={styles.caret} />
              <span>MATCH</span>
              <span>WINNER</span>
              <span className={styles.num}>LENGTH</span>
              <span className={styles.num}>SCORE</span>
              <span className={styles.num}>KILLS</span>
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

// One standing row, expandable to the matches that fed the record: each match
// this controller played, from its perspective (opponent, outcome, score).
function StandingRow({
  standing,
  matches,
  labelFor,
}: {
  standing: Standing;
  matches: MatchSummary[];
  labelFor: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const played = matches.filter(
    (m) =>
      m.redId === standing.participantId || m.blueId === standing.participantId,
  );
  return (
    <>
      <button
        type="button"
        className={`${styles.standingsRow} ${styles.rowButton}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.caret}>{open ? "▾" : "▸"}</span>
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
      </button>
      {open && (
        <div className={styles.expand}>
          {played.length === 0 ? (
            <p className={styles.expandEmpty}>No matches recorded.</p>
          ) : (
            <ul className={styles.expandList}>
              {played.map((match) => {
                const isRed = match.redId === standing.participantId;
                const opponentId = isRed ? match.blueId : match.redId;
                const myScore = isRed ? match.redScore : match.blueScore;
                const oppScore = isRed ? match.blueScore : match.redScore;
                const outcome =
                  match.winner === null
                    ? { label: "Drew", cls: styles.outcomeDraw }
                    : match.winner === standing.participantId
                      ? { label: "Won", cls: styles.outcomeWon }
                      : { label: "Lost", cls: styles.outcomeLost };
                return (
                  <li key={match.matchId} className={styles.expandItem}>
                    <span className={styles.expandVs}>
                      vs {labelFor(opponentId)}
                    </span>
                    <span className={outcome.cls}>{outcome.label}</span>
                    <span className={styles.num}>
                      {myScore}–{oppScore}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

// One match row, expandable to the detailed run info (fuel totals, how it was
// decided, any forfeit reason) and the replay control.
function MatchRow({
  match,
  labelFor,
  onReplay,
}: {
  match: MatchSummary;
  labelFor: (id: string) => string;
  onReplay: () => void;
}) {
  const [open, setOpen] = useState(false);
  const winner = match.winner ? labelFor(match.winner) : "Draw";
  return (
    <>
      <button
        type="button"
        className={`${styles.matchesRow} ${styles.rowButton}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.caret}>{open ? "▾" : "▸"}</span>
        <span className={styles.match}>
          <span className={styles.scoreRed}>{labelFor(match.redId)}</span>
          {" vs "}
          <span className={styles.scoreBlue}>{labelFor(match.blueId)}</span>
        </span>
        <span className={styles.winner}>{winner}</span>
        <span className={styles.num}>{match.ticks}</span>
        <span className={styles.num}>
          {match.redScore}–{match.blueScore}
        </span>
        <span className={styles.num}>
          {match.redKills}–{match.blueKills}
        </span>
      </button>
      {open && (
        <div className={styles.expand}>
          <dl className={styles.detail}>
            <dt className={styles.detailTerm}>Decided by</dt>
            <dd>{match.winType}</dd>
            <dt className={styles.detailTerm}>Fuel</dt>
            <dd>
              <span className={styles.scoreRed}>
                {labelFor(match.redId)} {match.redFuel.toLocaleString()}
              </span>
              {" — "}
              <span className={styles.scoreBlue}>
                {labelFor(match.blueId)} {match.blueFuel.toLocaleString()}
              </span>
              {match.winType === "efficiency" && " · decided the match"}
            </dd>
            {match.detail && (
              <>
                <dt className={styles.detailTerm}>Note</dt>
                <dd>{match.detail}</dd>
              </>
            )}
          </dl>
          <div className={styles.detailActions}>
            <button
              type="button"
              className={styles.replay}
              onClick={onReplay}
              disabled={match.replayKey == null}
            >
              Replay
            </button>
          </div>
        </div>
      )}
    </>
  );
}
