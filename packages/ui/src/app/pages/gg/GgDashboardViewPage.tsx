// **A dashboard, rendered** — the board at `/gg/dashboards/:dashboardId`.
//
// The whole board is **one** request. That is not a performance tweak, it is what makes a
// board a board: `POST /gg/query/batch` answers every panel from a single read of the
// backend's document index, so eight panels report one corpus. Answered panel-by-panel
// they would re-scan the same documents eight times and — because the index reconciles on
// a timer — two panels of the same page could legitimately come back from two different
// corpora, which reads as a data bug rather than as a stale cache. The batch is asserted
// in this page's test, by request count, for exactly that reason.
//
// The board owns one range for every panel on it. A panel never gets its own picker: the
// range is what an operator changes while leaving every question alone, and eight panels
// each answering over a different window is not a board. Changing it re-runs the batch and
// holds the previous render at reduced opacity rather than tearing the grid down, so
// nothing jumps under the reader.
//
// The built-in overview board is resolved from code (`overviewDashboard.ts`) rather than
// fetched, and runs through this page unchanged — same compiler, same batch, same panel
// component. A hardcoded overview keeps rendering after a field is renamed, just wrong;
// this one breaks visibly, in the panel that owns the stale field.
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import type {
  GgDashboard,
  GgQueryResponse,
} from "@test-cabinet/run-record/gg-query";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { GgDashboardPanel } from "./dashboards/GgDashboardPanel";
import { compilePanels } from "./dashboards/dashboardQueries";
import {
  OVERVIEW_DASHBOARD,
  OVERVIEW_DASHBOARD_ID,
} from "./dashboards/overviewDashboard";
import { DEFAULT_RANGE, TimeRangePicker, rangeById } from "./discover/TimeRangePicker";
import { GG_CHROME } from "./ggChrome";
import styles from "./dashboards/GgDashboards.module.scss";
import discover from "./discover/GgDiscover.module.scss";

export function GgDashboardViewPage() {
  const { dashboardId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { token } = useAuth();
  const { client: backend } = useBackend();

  const [board, setBoard] = useState<GgDashboard | null>(
    dashboardId === OVERVIEW_DASHBOARD_ID ? OVERVIEW_DASHBOARD : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<GgQueryResponse[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The board's own saved range is the default; a `?range=` in the URL overrides it, so a
  // board can be *shared* over a window without being *edited* to it.
  const range = rangeById(params.get("range") ?? board?.rangeId ?? DEFAULT_RANGE.id);

  const fetchBoard = backend?.getGgDashboard;
  useEffect(() => {
    if (dashboardId === OVERVIEW_DASHBOARD_ID) {
      setBoard(OVERVIEW_DASHBOARD);
      return;
    }
    if (!fetchBoard || !token) return;
    let active = true;
    setLoadError(null);
    fetchBoard(dashboardId, token)
      .then((loaded) => {
        if (active) setBoard(loaded);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setBoard(null);
        setLoadError(String(e));
      });
    return () => {
      active = false;
    };
  }, [fetchBoard, token, dashboardId]);

  // Compiled once per (board, range) — not per panel and not per render — so all eight
  // panels resolve their range against **one** instant. Eight `Date.now()` calls would
  // each get a marginally different window, which is invisible and wrong.
  const compiled = useMemo(
    () => (board ? compilePanels(board.panels, range, Date.now()) : []),
    [board, range],
  );

  const runBatch = backend?.runGgQueryBatch;
  useEffect(() => {
    if (!runBatch || !token || compiled.length === 0) return;
    let active = true;
    setBusy(true);
    setError(null);
    runBatch({ queries: compiled.map((entry) => entry.query) }, token)
      .then((response) => {
        if (!active) return;
        setResults(response.results);
        setBusy(false);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(String(e));
        setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [runBatch, token, compiled]);

  const setRange = (id: string) => {
    const next = new URLSearchParams(params);
    if (id === (board?.rangeId ?? DEFAULT_RANGE.id)) next.delete("range");
    else next.set("range", id);
    setParams(next, { replace: true });
  };

  return (
    <PageLayout chrome={GG_CHROME}>
      <PromptHeader
        command={`--gg dashboard ${board?.name ?? dashboardId}`}
        comment={<>// {board?.description || "one range, one request, N panels"}</>}
      />

      {loadError && <p className={discover.error}>{loadError}</p>}

      {board && (
        <>
          {/* One filter row above everything it scopes — never a picker inside a card. */}
          <div className={styles.controls}>
            <TimeRangePicker value={range} onChange={(next) => setRange(next.id)} />
            <span className={styles.spacer} />
            {error ? (
              <span className={discover.error} role="status">
                {error}
              </span>
            ) : (
              <span className={styles.empty} role="status">
                {busy
                  ? "Refreshing…"
                  : `${board.panels.length} ${
                      board.panels.length === 1 ? "panel" : "panels"
                    }, one request`}
              </span>
            )}
          </div>

          <div
            className={`${styles.grid} ${busy && results ? styles.gridBusy : ""}`}
            data-testid="gg-dashboard-grid"
          >
            {compiled.map((entry, index) => (
              <GgDashboardPanel
                key={`${entry.panel.title}:${index}`}
                compiled={entry}
                result={results?.[index]}
                rangeId={range.id}
              />
            ))}
          </div>

          {board.panels.length === 0 && (
            <p className={styles.empty}>
              This board has no panels yet. Add one from the Dashboards tab.
            </p>
          )}
        </>
      )}
    </PageLayout>
  );
}
