import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { LadderOut, LadderProgress } from "@clockwyrks/run-record/ladders";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useConfirm } from "../../components/ConfirmDialog";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import { SubmitNotice } from "../../components/SubmitNotice";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";
import ladderStyles from "./Ladder.module.scss";

/** One ladder card's roll-up: how much of the climb is done, and where it stands. */
export interface LadderSummary {
  /** Rungs passed, summed across every climber. */
  rungsCleared: number;
  /** Rungs on offer: every climber's whole climb. */
  rungsTotal: number;
  /** The bar's filled fraction. */
  donePct: number;
  /** Every climber on the ladder. */
  climbers: number;
  /** Climbers working a rung. */
  running: number;
  /** Climbers that passed every rung. */
  completed: number;
  /** Climbers that failed a rung. */
  failed: number;
  /** Climbers standing on a rung nothing the ladder does by itself will move. */
  blocked: number;
  /** Climbers their owner paused. */
  paused: number;
  /** Completed runs across the board the signed-in account has not reviewed —
   *  information only: reviews are labels and never move a climb. */
  unreviewed: number;
}

/**
 * Roll one ladder's board up into the numbers a card shows.
 *
 * Progress is measured in **rungs passed across every climber**, not in climbers
 * finished, because a ladder's whole purpose is to find out where each model stops:
 * a board where four of five models failed halfway is two thirds climbed and nearly
 * finished, while "0 of 5 completed" describes it as if nothing had happened. A
 * completed climber has passed every rung; any other has passed exactly the rungs
 * below the one it stands on, which is what `position` (counted from zero) already is.
 */
export function ladderSummary(progress: LadderProgress): LadderSummary {
  const rungsTotal = progress.rungs.length * progress.climbers.length;
  const rungsCleared = progress.climbers.reduce(
    (total, climber) =>
      total + (climber.currentRung?.position ?? progress.rungs.length),
    0,
  );
  return {
    rungsCleared,
    rungsTotal,
    donePct: rungsTotal > 0 ? (rungsCleared / rungsTotal) * 100 : 0,
    climbers: progress.climbers.length,
    running: progress.climbersRunning,
    completed: progress.climbersCompleted,
    failed: progress.climbersFailed,
    blocked: progress.climbersBlocked,
    paused: progress.climbersPaused,
    unreviewed: progress.runsUnreviewed,
  };
}

/**
 * A card's climber counts as one line: Climbers, Running, Completed, and Failed always,
 * then Blocked and Paused only while a climber is in that state.
 */
export function ladderSummaryLine(summary: LadderSummary): string {
  const parts = [
    `${summary.climbers} climber${summary.climbers === 1 ? "" : "s"}`,
    `${summary.running} running`,
    `${summary.completed} completed`,
    `${summary.failed} failed`,
  ];
  if (summary.blocked > 0) parts.push(`${summary.blocked} blocked`);
  if (summary.paused > 0) parts.push(`${summary.paused} paused`);
  return parts.join(" · ");
}

// The Ladders tab (`/account/ladders`): the signed-in reviewer's ladders, each a card
// with how far its climbers got, linking to its own dashboard, plus create / edit /
// delete. A sibling of the Coverage tab, not a mode of it — a plan fills a matrix,
// a ladder walks an ordered climb and stops each model at the first rung it fails. Console-only and gated on a signed-in account (ladders are per-account).
//
// Each card's progress needs the ladder's board, which is a request per ladder. The
// list therefore renders from the (single) declaration listing first and fills the
// bars in as the boards land, so a slow or failing board leaves one card without a
// bar rather than leaving the reviewer without a page.
export function LaddersPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { confirm } = useConfirm();

  const [ladders, setLadders] = useState<LadderOut[] | null>(null);
  const [boards, setBoards] = useState<Record<string, LadderProgress>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!backend?.listLadders || !token) return;
    setLadders(await backend.listLadders(token));
  }, [backend, token]);

  useEffect(() => {
    if (!backend?.listLadders || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    backend
      .listLadders(token)
      .then((list) => {
        if (!active) return;
        setLadders(list);
        setLoading(false);
        for (const entry of list) {
          backend
            .getLadderProgress?.(entry.id, token)
            .then((board) => {
              if (!active) return;
              setBoards((current) => ({ ...current, [entry.id]: board }));
            })
            .catch(() => {
              /* one board short: that card simply shows no bar */
            });
        }
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [backend, token]);

  const deleteLadder = useCallback(
    async (id: string, name: string) => {
      if (!backend?.deleteLadder || !token) return;
      if (
        !(await confirm({
          title: "Delete ladder",
          message:
            `Delete the ladder “${name}”? This removes its rungs, every climber's ` +
            `recorded verdicts, and their steering, and cannot be undone. Runs it ` +
            `already launched are left alone; halt it first if you want those stopped.`,
          confirmLabel: "Delete ladder",
        }))
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await backend.deleteLadder(id, token);
        await reload();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, reload, confirm],
  );

  if (!token) {
    return (
      <PageLayout>
        <PromptHeader command="--ladders" comment={<>// your ladders</>} />
        <AccountTabs active="ladders" />
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to use ladders. They are saved to your account. Use the
          account control in the top bar to register or log in.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PromptHeader
        command="--ladders"
        comment={<>// your ladders</>}
        titleActions={
          <Link className={exec.primary} to={routes.accountLadderNew()}>
            + New ladder
          </Link>
        }
      />
      <AccountTabs active="ladders" />

      <SubmitNotice message={error} />

      {loading ? (
        <LoadingState size="section" label="Loading ladders…" />
      ) : !ladders || ladders.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            You have no ladders yet. A ladder is an ordered climb: pin the cases
            you want attempted easiest-first, point a set of models at it, and
            each model climbs on its own until it fails a rung, so you find out
            how far each one gets instead of paying for a full matrix.
          </p>
          <Link className={exec.primary} to={routes.accountLadderNew()}>
            Create your first ladder
          </Link>
        </div>
      ) : (
        <div className={styles.list}>
          {ladders.map((entry) => {
            const board = boards[entry.id];
            const summary = board ? ladderSummary(board) : null;
            return (
              <div key={entry.id} className={styles.rowCard}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitleRow}>
                    <Link
                      className={styles.rowTitleLink}
                      to={routes.accountLadder(entry.id)}
                    >
                      {entry.name}
                    </Link>
                    {/* A disabled ladder — which every ladder is until it is enabled —
                        is otherwise indistinguishable from one whose climbers have all
                        finished. */}
                    {entry.paused && (
                      <span className={styles.pausedBadge}>disabled</span>
                    )}
                  </span>
                  <span className={styles.rowSub}>
                    {entry.rungs.length} rung
                    {entry.rungs.length === 1 ? "" : "s"} · {entry.runsPerCell}{" "}
                    runs/rung
                    {summary != null &&
                      summary.unreviewed > 0 &&
                      ` · ${summary.unreviewed} unreviewed`}
                  </span>
                </div>
                <div className={styles.rowRight}>
                  {summary && (
                    <span
                      // The bar over the counts, both right-aligned, so the counts
                      // changing length as climbers move never moves the bar.
                      className={`${styles.rowProgress} ${ladderStyles.ladderProgress}`}
                      title={`${summary.rungsCleared} of ${summary.rungsTotal} rungs passed across every climber`}
                    >
                      <span className={styles.groupBar} aria-hidden>
                        <span
                          className={styles.groupBarDone}
                          style={{ width: `${summary.donePct}%` }}
                        />
                      </span>
                      <span className={styles.groupCount}>
                        {ladderSummaryLine(summary)}
                      </span>
                    </span>
                  )}
                  <span className={styles.rowActions}>
                    <Link
                      className={exec.secondary}
                      to={routes.accountLadderEdit(entry.id)}
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      className={exec.danger}
                      disabled={busy}
                      onClick={() => deleteLadder(entry.id, entry.name)}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}
