import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Panel } from "@test-cabinet/ui";
import type { ControllerRef, MatchSummary } from "@test-cabinet/run-record";
import { useGalleryData, type ArenaApi } from "../../../data/galleryContext";
import { useControllerName } from "../../../data/useControllerName";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import { routes } from "../../../routes";
import { ReplayOverlay } from "../../runs/[runId]/AdversarialReplaySection";
import styles from "./TestCaseArenaPage.module.scss";

// The Arena tab (`/test-cases/:slug/arena`): pit two controllers in a transient
// quick match (watched in-browser, never persisted) or run a tournament over a
// field (persisted and revisitable). It is a console-only, adversarial-only
// surface — the layout hides the tab otherwise, and this page guards on the same
// capability so a hand-typed URL degrades to a short "not available" note.
export function TestCaseArenaPage() {
  return (
    <TestCaseDetailLayout tab="arena">
      {({ testCase, variant }) => (
        <ArenaContent testCase={testCase} variant={variant} />
      )}
    </TestCaseDetailLayout>
  );
}

function ArenaContent({
  testCase,
  variant,
}: {
  testCase: TestCaseSummary;
  variant: VariantSummary;
}) {
  const { canExecute, arena } = useGalleryData();

  // The arena needs a worker to run on; without one (or on the static site) the
  // page renders nothing actionable.
  if (!arena || !canExecute || testCase.testType !== "adversarial") {
    return (
      <section className={styles.section}>
        <Panel>
          <p className={styles.muted}>
            The arena is not available here — it runs head-to-head matches on a
            connected worker, for adversarial test cases only.
          </p>
        </Panel>
      </section>
    );
  }

  return <ArenaPanels arena={arena} testCase={testCase} variant={variant} />;
}

function ArenaPanels({
  arena,
  testCase,
  variant,
}: {
  arena: ArenaApi;
  testCase: TestCaseSummary;
  variant: VariantSummary;
}) {
  const [controllers, setControllers] = useState<ControllerRef[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The worker a match/tournament runs on. It also decides which worker's local
  // (unpushed) runs appear in the controller list — pushed and baseline
  // controllers resolve on any worker. Defaults to the first listed (the active
  // one).
  const workers = useMemo(() => arena.listWorkers(), [arena]);
  const [workerId, setWorkerId] = useState<string>(workers[0]?.id ?? "");
  useEffect(() => {
    // Keep the selection valid as the worker set changes (added/removed).
    if (!workers.some((w) => w.id === workerId)) {
      setWorkerId(workers[0]?.id ?? "");
    }
  }, [workers, workerId]);

  // Resolve the controllers available to pit (committed baselines + the chosen
  // worker's produced runs + the case's pushed controllers) whenever the case or
  // the selected worker changes.
  useEffect(() => {
    let active = true;
    setControllers([]);
    setLoadError(null);
    arena
      .listControllers(testCase.slug, testCase.latestVersion, workerId)
      .then((cs) => active && setControllers(cs))
      .catch((e) => active && setLoadError(String(e)));
    return () => {
      active = false;
    };
  }, [arena, testCase.slug, testCase.latestVersion, workerId]);

  return (
    <section className={styles.section}>
      {workers.length > 1 && (
        <Panel>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Worker</span>
            <select
              className={styles.select}
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
            >
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.muted}>
            Matches run on this worker, and its locally-produced (unpushed) runs
            are listed below. Pushed implementations are selectable on any
            worker.
          </p>
        </Panel>
      )}
      {loadError && (
        <p className={`${styles.notice} ${styles.error}`}>{loadError}</p>
      )}
      <QuickMatchPanel
        arena={arena}
        testCase={testCase}
        controllers={controllers}
        workerId={workerId}
      />
      <TournamentPanel
        arena={arena}
        testCase={testCase}
        variant={variant}
        controllers={controllers}
        workerId={workerId}
      />
    </section>
  );
}

// A controller's display label: the model display name (or baseline name), with
// the baselines, pushed implementations, and this worker's produced runs grouped
// under <optgroup>s.
function ControllerOptions({ controllers }: { controllers: ControllerRef[] }) {
  const controllerName = useControllerName();
  const baselines = controllers.filter((c) => c.kind === "baseline");
  const pushed = controllers.filter((c) => c.kind === "pushed");
  const runs = controllers.filter((c) => c.kind === "run");
  return (
    <>
      {baselines.length > 0 && (
        <optgroup label="Baselines">
          {baselines.map((c) => (
            <option key={c.id} value={c.id}>
              {controllerName(c)}
            </option>
          ))}
        </optgroup>
      )}
      {pushed.length > 0 && (
        <optgroup label="Pushed implementations">
          {pushed.map((c) => (
            <option key={c.id} value={c.id}>
              {controllerName(c)}
            </option>
          ))}
        </optgroup>
      )}
      {runs.length > 0 && (
        <optgroup label="This worker">
          {runs.map((c) => (
            <option key={c.id} value={c.id}>
              {controllerName(c)}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

function QuickMatchPanel({
  arena,
  testCase,
  controllers,
  workerId,
}: {
  arena: ArenaApi;
  testCase: TestCaseSummary;
  controllers: ControllerRef[];
  workerId: string;
}) {
  const [redId, setRedId] = useState("");
  const [blueId, setBlueId] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    replay: unknown | null;
    summary: MatchSummary;
  } | null>(null);
  const [launched, setLaunched] = useState(false);

  // Default the two sides to the first two controllers once they resolve.
  useEffect(() => {
    if (controllers.length === 0) return;
    setRedId((id) => id || (controllers[0]?.id ?? ""));
    setBlueId((id) => id || (controllers[1]?.id ?? controllers[0]?.id ?? ""));
  }, [controllers]);

  const byId = useMemo(
    () => new Map(controllers.map((c) => [c.id, c])),
    [controllers],
  );
  const canRun = Boolean(redId && blueId && !running);

  async function onRun() {
    const red = byId.get(redId);
    const blue = byId.get(blueId);
    if (!red || !blue) return;
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      const outcome = await arena.runMatch({
        testCase: testCase.slug,
        version: testCase.latestVersion,
        red,
        blue,
        workerId,
      });
      setResult(outcome);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Panel>
      <h2 className={styles.heading}>Quick match</h2>
      <p className={styles.muted}>
        Pit two controllers head-to-head and watch the replay. Nothing is saved.
      </p>

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Red</span>
          <select
            className={styles.select}
            value={redId}
            onChange={(e) => setRedId(e.target.value)}
          >
            <ControllerOptions controllers={controllers} />
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Blue</span>
          <select
            className={styles.select}
            value={blueId}
            onChange={(e) => setBlueId(e.target.value)}
          >
            <ControllerOptions controllers={controllers} />
          </select>
        </label>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={onRun}
          disabled={!canRun}
        >
          {running ? "Running…" : "Run match"}
        </button>
      </div>

      {error && <p className={`${styles.notice} ${styles.error}`}>{error}</p>}

      {result && (
        <div className={styles.matchResult}>
          <MatchSummaryLine
            summary={result.summary}
            controllers={controllers}
          />
          {result.replay == null ? (
            <p className={styles.muted}>
              No replay is available — a controller failed to load.
            </p>
          ) : !launched ? (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setLaunched(true)}
            >
              Launch replay
            </button>
          ) : (
            <ReplayOverlay
              label={`Quick match ${result.summary.matchId}`}
              replayData={result.replay}
              onExit={() => setLaunched(false)}
            />
          )}
        </div>
      )}
    </Panel>
  );
}

function TournamentPanel({
  arena,
  testCase,
  variant,
  controllers,
  workerId,
}: {
  arena: ArenaApi;
  testCase: TestCaseSummary;
  variant: VariantSummary;
  controllers: ControllerRef[];
  workerId: string;
}) {
  const navigate = useNavigate();
  const controllerName = useControllerName();
  const byId = useMemo(
    () => new Map(controllers.map((c) => [c.id, c])),
    [controllers],
  );
  const nameForId = (id: string) => {
    const c = byId.get(id);
    return c ? controllerName(c) : id;
  };
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    played: number;
    total: number;
    summary: MatchSummary;
  } | null>(null);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canRun = picked.size >= 2 && !running;

  async function onRun() {
    const participants = controllers.filter((c) => picked.has(c.id));
    if (participants.length < 2) return;
    setError(null);
    setProgress(null);
    setRunning(true);
    try {
      const id = await arena.runTournament({
        testCase: testCase.slug,
        version: testCase.latestVersion,
        variant: variant.slug,
        participants,
        workerId,
      });
      // Observe the field on the same worker it was started on; navigate to the
      // persisted detail when it finishes.
      const stop = arena.subscribeTournament(
        id,
        {
          onProgress: (p) => setProgress(p),
          onDone: (record, err) => {
            stop();
            setRunning(false);
            if (record) navigate(routes.tournamentDetail(record.id));
            else setError(err ?? "The tournament failed to complete.");
          },
          onError: (e) => {
            stop();
            setRunning(false);
            setError(String(e));
          },
        },
        workerId,
      );
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  }

  return (
    <Panel>
      <h2 className={styles.heading}>Tournament</h2>
      <p className={styles.muted}>
        Pick at least two controllers; every pair plays once and the standings
        are saved. Ranked by total points (summed banked seeds).
      </p>

      <ul className={styles.pickList}>
        {controllers.map((c) => (
          <li key={c.id} className={styles.pickItem}>
            <label className={styles.pick}>
              <input
                type="checkbox"
                checked={picked.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span className={styles.pickLabel}>{controllerName(c)}</span>
              {c.kind === "baseline" ? (
                <span className={styles.pickKind}>{c.kind}</span>
              ) : (
                <span className={styles.pickId} title={c.id}>
                  {c.id}
                </span>
              )}
            </label>
          </li>
        ))}
      </ul>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={onRun}
          disabled={!canRun}
        >
          {running ? "Running…" : `Run tournament (${picked.size})`}
        </button>
      </div>

      {running && progress && (
        <div className={styles.progress}>
          <div className={styles.progressText}>
            {progress.played} / {progress.total} complete
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.played}
          >
            <div
              className={styles.progressFill}
              style={{
                width: `${
                  progress.total > 0
                    ? (progress.played / progress.total) * 100
                    : 0
                }%`,
              }}
            />
          </div>
          <div className={styles.progressSub}>
            {nameForId(progress.summary.redId)} vs{" "}
            {nameForId(progress.summary.blueId)}
          </div>
        </div>
      )}

      {error && <p className={`${styles.notice} ${styles.error}`}>{error}</p>}
    </Panel>
  );
}

// A one-line summary of a finished match: winner, win type, length, kills.
function MatchSummaryLine({
  summary,
  controllers,
}: {
  summary: MatchSummary;
  controllers: ControllerRef[];
}) {
  const controllerName = useControllerName();
  const labelFor = (id: string) => {
    const c = controllers.find((c) => c.id === id);
    return c ? controllerName(c) : id;
  };
  const winner = summary.winner ? labelFor(summary.winner) : "Draw";
  return (
    <dl className={styles.record}>
      <dt className={styles.recordTerm}>Winner</dt>
      <dd>
        {winner} · {summary.winType}
      </dd>
      <dt className={styles.recordTerm}>Score</dt>
      <dd>
        <span className={styles.scoreRed}>
          {labelFor(summary.redId)} {summary.redScore}
        </span>
        {" — "}
        <span className={styles.scoreBlue}>
          {labelFor(summary.blueId)} {summary.blueScore}
        </span>
      </dd>
      <dt className={styles.recordTerm}>Length</dt>
      <dd>{summary.ticks} ticks</dd>
      <dt className={styles.recordTerm}>Kills</dt>
      <dd>
        {summary.redKills} – {summary.blueKills}
      </dd>
      <dt className={styles.recordTerm}>Fuel</dt>
      <dd>
        <span className={styles.scoreRed}>
          {labelFor(summary.redId)} {summary.redFuel.toLocaleString()}
        </span>
        {" — "}
        <span className={styles.scoreBlue}>
          {labelFor(summary.blueId)} {summary.blueFuel.toLocaleString()}
        </span>
        {summary.winType === "efficiency" && " · decided the match"}
      </dd>
    </dl>
  );
}
