import type {
  LadderSummary,
  DispatchStatus,
} from "@clockwyrks/backend-api/ladders";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import { AccountTabs } from "./AccountTabs";
import styles from "./Coverage.module.scss";
import { dispatchBadgeClass } from "./ladder-dispatch";
import ladderStyles from "./Ladder.module.scss";
import { dispatchStatusLabel } from "./LadderPage";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { useConfirm } from "../../components/ConfirmDialog";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { SubmitNotice } from "../../components/SubmitNotice";
import { routes } from "../../routes";
import exec from "../runs/RunExec.module.scss";

/** Everything one ladder card shows, read off its summary. */
export interface LadderCardView {
  /** The configuration in one line: "4 rungs · 2 runs/rung · 3 climbers". */
  description: string;
  /** Where the latest dispatch stands, or null for a ladder never run. */
  status: DispatchStatus | null;
  /** The status badge's text. */
  badge: string;
  /** The bar's filled fraction: runs done of the dispatch's total. */
  donePct: number;
  /** The bar's hover text: the run detail. */
  title: string;
  /** Rung-slot totals across the whole ladder, never per climber. */
  counts: { running: number; passed: number; failed: number; skipped: number };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Read a ladder's summary into what its card shows.
 *
 * The bar measures **runs**: how much of the latest dispatch's execution is behind it.
 * A finished or failed run fills it, and so does every run a rung slot will never need
 * — a slot skipped because its climber failed lower down, or one decided before its
 * target — so a full bar means nothing is left to execute. Beneath it, the rung-slot
 * totals say how the runs that could run went. A blocked slot is still the dispatch's
 * work in progress, so it counts as running here and the hover text calls it out.
 */
export function ladderCardView(summary: LadderSummary): LadderCardView {
  const description = [
    plural(summary.rungs, "rung"),
    `${plural(summary.runsPerCell, "run")}/rung`,
    plural(summary.climbers, "climber"),
  ].join(" · ");
  const dispatch = summary.dispatch;
  if (!dispatch) {
    return {
      description,
      status: null,
      badge: dispatchStatusLabel(null),
      donePct: 0,
      title: "Not run yet. Open the ladder and press Run ladder to start it.",
      counts: { running: 0, passed: 0, failed: 0, skipped: 0 },
    };
  }
  const { runs, slots } = dispatch;
  let title = `${runs.done} of ${runs.total} runs done · ${runs.inFlight} in flight`;
  if (slots.blocked > 0) title += ` · ${slots.blocked} blocked`;
  if (slots.pending > 0) title += ` · ${slots.pending} pending`;
  if (dispatch.status === "needsAttention") {
    title += " · nothing is running: the blocked climbers are waiting on you";
  }
  return {
    description,
    status: dispatch.status,
    badge: dispatchStatusLabel(dispatch.status),
    donePct: runs.total > 0 ? Math.min(100, (runs.done / runs.total) * 100) : 0,
    title,
    counts: {
      running: slots.running + slots.blocked,
      passed: slots.passed,
      failed: slots.failed,
      skipped: slots.skipped,
    },
  };
}

// One figure of the counts line, in a slot of fixed width so a number growing never
// moves the words around it.
function Count({ n, label }: { n: number; label: string }) {
  return (
    <span className={ladderStyles.cardCount}>
      <span className={ladderStyles.cardCountNum}>{n}</span> {label}
    </span>
  );
}

// The Ladders tab (`/account/ladders`): the signed-in reviewer's ladders, each a card
// with its configuration and its latest dispatch's standing, linking to its own
// dashboard, plus create / edit / delete. A sibling of the Coverage tab, not a mode of
// it — a plan fills a matrix, a ladder walks an ordered climb and stops each model at
// the first rung it fails. Console-only and gated on a signed-in account.
//
// The whole list is one request (`GET /ladders/summary`), and every card is laid out
// in fixed slots: the right side lines up with the name row and the description row,
// and a number changing never moves anything. A card too narrow for that stacks its
// slots instead, by its own width rather than the viewport's.
export function LaddersPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { confirm } = useConfirm();

  const [ladders, setLadders] = useState<LadderSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!backend?.getLaddersSummary || !token) return;
    setLadders(await backend.getLaddersSummary(token));
  }, [backend, token]);

  useEffect(() => {
    if (!backend?.getLaddersSummary || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    backend
      .getLaddersSummary(token)
      .then((list) => {
        if (!active) return;
        setLadders(list);
        setLoading(false);
      })
      .catch((error_) => {
        if (!active) return;
        setError(String(error_));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [backend, token]);

  const deleteLadder = useCallback(
    async (id: string, name: string) => {
      if (
        !backend?.deleteLadder ||
        !token ||
        !(await confirm({
          title: "Delete ladder",
          message:
            `Delete the ladder “${name}”? This removes its configuration and its ` +
            `latest dispatch's standing, and cannot be undone. Runs it launched are ` +
            `left alone; stop it first if you want those cancelled.`,
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
      } catch (error_) {
        setError(String(error_));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, reload, confirm],
  );

  return token ? (
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
            you want attempted easiest-first and point a set of models at it.
            Press Run ladder and each model climbs on its own until it fails a
            rung, so you find out how far each one gets instead of paying for a
            full matrix.
          </p>
          <Link className={exec.primary} to={routes.accountLadderNew()}>
            Create your first ladder
          </Link>
        </div>
      ) : (
        <div className={[styles.list, ladderStyles.ladderList].join(" ")}>
          {ladders.map((entry) => {
            const view = ladderCardView(entry);
            return (
              <div
                key={entry.id}
                className={`${styles.rowCard} ${ladderStyles.ladderCard}`}
              >
                <Link
                  className={`${styles.rowTitleLink} ${ladderStyles.cardName}`}
                  to={routes.accountLadder(entry.id)}
                >
                  {entry.name}
                </Link>
                <span className={`${styles.rowSub} ${ladderStyles.cardSub}`}>
                  {view.description}
                </span>
                <span className={ladderStyles.cardStatus}>
                  <span
                    className={[
                      ladderStyles.cardBadge,
                      dispatchBadgeClass(view.status),
                    ].join(" ")}
                  >
                    {view.badge}
                  </span>
                  <span
                    className={`${styles.groupBar} ${ladderStyles.cardBar}`}
                    role="progressbar"
                    aria-label={`${entry.name}: runs done`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(view.donePct)}
                    title={view.title}
                  >
                    <span
                      className={styles.groupBarDone}
                      style={{ width: `${view.donePct}%` }}
                    />
                  </span>
                </span>
                <span
                  className={ladderStyles.cardCounts}
                  title="Rung slots — one climber on one rung — across the whole ladder."
                >
                  <Count n={view.counts.running} label="running" />
                  <span className={ladderStyles.cardCountSep} aria-hidden>
                    {" · "}
                  </span>
                  <Count n={view.counts.passed} label="passed" />
                  <span className={ladderStyles.cardCountSep} aria-hidden>
                    {" · "}
                  </span>
                  <Count n={view.counts.failed} label="failed" />
                  <span className={ladderStyles.cardCountSep} aria-hidden>
                    {" · "}
                  </span>
                  <Count n={view.counts.skipped} label="skipped" />
                </span>
                <span
                  className={`${styles.rowActions} ${ladderStyles.cardActions}`}
                >
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
            );
          })}
        </div>
      )}
    </PageLayout>
  ) : (
    <PageLayout>
      <PromptHeader command="--ladders" comment={<>// your ladders</>} />
      <AccountTabs active="ladders" />
      <p className={`${exec.notice} ${exec.warn}`}>
        Sign in to use ladders. They are saved to your account. Use the account
        control in the top bar to register or log in.
      </p>
    </PageLayout>
  );
}
