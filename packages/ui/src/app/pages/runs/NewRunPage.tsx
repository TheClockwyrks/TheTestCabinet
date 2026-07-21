import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../../../client/auth";
import { useBackend, useWorkers } from "../../../client/context";
import type { Model } from "../../../client/types";
import { harnesses } from "../../data/harnesses";
import { familyOf } from "../../data/families";
import {
  BUILT_IN_ORCHESTRATORS,
  DEFAULT_ORCHESTRATOR_SLUG,
} from "../../data/orchestrators";
import {
  OPENROUTER_PROVIDER,
  PROVIDERS,
  harnessUsesProvider,
  resolveLaunchModel,
} from "../../data/providers";
import { ModelCombobox } from "../../components/ModelCombobox";
import { launchBatch, type LaunchItem } from "./launchBatch";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import type { CatalogTab } from "../../routes";
import { useCatalog } from "../../runtime/useCatalog";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useTestCases } from "../../data/useTestCases";
import { CATALOG_TABS, tabOf } from "../../data/testCaseTabs";
import type { TestCaseSummary } from "../../data/testCases";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import styles from "./RunExec.module.scss";

// The test-case type selector's categories: the catalog's type tabs (the same
// partitioning the Test Cases page groups cases under) plus a Game Jams category.
// Game jams share the catalog pipeline but are surfaced on their own pages, so
// `tabOf` never files them under a tab — they get their own category here. The
// case dropdown below is scoped to the chosen category.
type RunCategory = CatalogTab | "game-jam";

const RUN_CATEGORIES: ReadonlyArray<{ value: RunCategory; label: string }> = [
  ...CATALOG_TABS.map((entry) => ({
    value: entry.tab as RunCategory,
    label: entry.label,
  })),
  { value: "game-jam", label: "Game Jams" },
];

// The category a case is filed under: its own for a game jam, otherwise the
// catalog tab it belongs to (null only until the case's catalog metadata loads).
function categoryOf(summary: TestCaseSummary): RunCategory | null {
  return summary.testType === "game-jam" ? "game-jam" : tabOf(summary);
}

// One harness/model[/provider] combination to launch. The test (case, version,
// variant, orchestrator, max runtime) is shared across all combinations; each
// combination varies the harness and model (and, for provider-routed harnesses,
// the provider) so a single form submission can fan out across many runs.
interface Combination {
  /** A stable client-side key so React and per-row edits track the right row. */
  id: string;
  harness: string;
  modelId: string;
  provider: string;
}

// The result of attempting to launch one combination. `runId` is set on success
// (and links to the live monitor); `error` on failure. Partial results are the
// norm — one combination failing must not abort the rest.
interface LaunchOutcome {
  key: string;
  harness: string;
  modelId: string;
  // 1-based repeat index within the combination (shown only when runCount > 1).
  runIndex: number;
  runId?: string;
  error?: string;
}

// Upper bound on the run-count multiplier — one form submission fans out to at most
// (combinations × RUN_COUNT_MAX) runs, so cap it to keep an accidental keystroke
// from enqueueing an absurd batch.
const RUN_COUNT_MAX = 20;

// Default number of automatic retries applied to every launched run, and the upper
// bound the field clamps to — mirroring the backend's `DEFAULT_RETRY_COUNT` /
// `MAX_RETRY_COUNT`. A retry fires only on an infra error or a catastrophic build,
// never on a timeout or a completed run.
const DEFAULT_RETRY_COUNT = 1;
const RETRY_COUNT_MAX = 10;

function makeCombination(id: string): Combination {
  return {
    id,
    harness: harnesses[0]?.slug ?? "",
    modelId: "",
    provider: OPENROUTER_PROVIDER,
  };
}

// Configure and launch one or more runs, then hand off to the live monitor (single
// run) or a launch summary (batch). The catalog (cases, harnesses, models) comes
// from the active backend; each run is submitted to the active worker. This is the
// routed home of the old console Run screen's configuration half — the event stream
// now lives on the monitor page.
export function NewRunPage() {
  const navigate = useNavigate();
  const { client: backend } = useBackend();
  const { active: worker } = useWorkers();
  const { token } = useAuth();
  const runtime = useRunsRuntime();
  // A test case's Run button links here with `?slug=…&version=…&variant=…` so the
  // form opens with that case pre-selected; absent the params the catalog leads
  // with its first case as before.
  const [params] = useSearchParams();
  // The case (if any) the form was navigated to with — a case's or jam's Run
  // button links here with `?slug=…`. Its presence is what distinguishes
  // "opened for this specific case" from "opened cold from the Runs page": only
  // in the former do we adopt the case's type; otherwise we default to E2E.
  const navSlug = params.get("slug");
  const sel = useCatalog({
    slug: navSlug,
    version: params.get("version"),
    variant: params.get("variant"),
  });
  const testCaseName = useTestCaseName();
  // The richer catalog (with each case's test type / asset kind) so the type
  // selector can bucket cases; `useCatalog` above only carries slugs + versions.
  const { testCases: summaries } = useTestCases();
  const summaryBySlug = useMemo(
    () => new Map(summaries.map((s) => [s.slug, s])),
    [summaries],
  );
  const slugCategory = (slug: string): RunCategory | null => {
    const summary = summaryBySlug.get(slug);
    return summary ? categoryOf(summary) : null;
  };

  // The selected test-case type, once the user has picked one. Until then it is
  // derived from the selected case (so arriving with a case pre-selected — e.g.
  // via a case's or jam's Run button — opens on that case's type).
  const [category, setCategory] = useState<RunCategory | null>(null);

  const [models, setModels] = useState<Model[]>([]);
  // The orchestrator that conducts the harness sessions. Selectable only for the
  // end-to-end test type (the selector below is hidden otherwise); every other
  // test type always submits the default `one-shot`. Built-in slugs only — the
  // worker has no access to a submitter's local orchestrator directory.
  const [orchestrator, setOrchestrator] = useState(DEFAULT_ORCHESTRATOR_SLUG);
  const [maxRuntime, setMaxRuntime] = useState("");
  // The harness/model combinations to launch. The form starts with one empty row
  // so the single-run path is unchanged in feel; "Add combination" fans out.
  const [combinations, setCombinations] = useState<Combination[]>(() => [
    makeCombination("c0"),
  ]);
  const nextComboId = useRef(1);
  // How many runs to launch per combination. Multiplies the fan-out (total launches
  // = combinations × runCount). Defaults to 1 so behavior is unchanged when
  // untouched.
  const [runCount, setRunCount] = useState(1);
  // Automatic retries applied to every launched run (a run-level setting, threaded
  // into each fan-out launch). Defaults to 1 so a run auto-retries once on an infra
  // error or catastrophic build; 0 disables retries.
  const [retryCount, setRetryCount] = useState(DEFAULT_RETRY_COUNT);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [results, setResults] = useState<LaunchOutcome[] | null>(null);

  useEffect(() => {
    if (!backend) return;
    backend
      .listModels()
      .then((ms) => {
        // Populate the catalog only — a model is never auto-selected. Every
        // combination's model must be explicitly picked (or typed), so the field
        // starts empty and stays empty until the operator chooses.
        setModels(ms);
      })
      .catch(() => {
        // The model catalog is optional; leave the field free-text.
      });
  }, [backend]);

  function updateCombination(id: string, patch: Partial<Combination>) {
    setCombinations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }
  function addCombination() {
    setCombinations((prev) => {
      const next = makeCombination(`c${nextComboId.current++}`);
      // Seed the new row with the last row's harness — fanning out across models
      // for one harness is the common case, so carry it forward rather than
      // resetting to the first harness (the model still starts empty to force an
      // explicit pick).
      const last = prev[prev.length - 1];
      return [...prev, last ? { ...next, harness: last.harness } : next];
    });
  }
  function removeCombination(id: string) {
    // Keep at least one row so the form is always usable.
    setCombinations((prev) =>
      prev.length <= 1 ? prev : prev.filter((c) => c.id !== id),
    );
  }

  const harnessName = (slug: string) =>
    harnesses.find((h) => h.slug === slug)?.displayName ?? slug;

  // The category actually in effect: the user's pick once made, otherwise the
  // navigated-to case's category, falling back to the first tab (E2E). Note this
  // derives from `navSlug`, not the auto-selected `sel.slug` — cold from the Runs
  // page there is no nav case, so it defaults to E2E rather than adopting whatever
  // category the catalog's first case happens to sit in.
  const activeCategory: RunCategory =
    category ??
    (navSlug ? slugCategory(navSlug) : null) ??
    RUN_CATEGORIES[0]!.value;

  // Choose the initial type + case once the catalog metadata resolves, before the
  // user picks. Reached from a case's (or jam's) Run button, open on that case's
  // type. Reached cold from the Runs page, default to E2E and lead with its first
  // case — rather than adopting the category of whatever case the catalog happens
  // to list first.
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || category !== null || !sel.slug) return;
    const currentCategory = slugCategory(sel.slug);
    // Wait until the selected case's catalog metadata has loaded to resolve it.
    if (currentCategory === null) return;
    initialized.current = true;
    if (navSlug) {
      setCategory(currentCategory);
      return;
    }
    const target = RUN_CATEGORIES[0]!.value;
    setCategory(target);
    // The auto-selected first case may not be in the default category; move the
    // selection to that category's first case so the case dropdown and the type
    // agree.
    if (currentCategory !== target) {
      const first = [...sel.cases]
        .filter((c) => slugCategory(c.slug) === target)
        .sort((a, b) =>
          testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
        )[0];
      if (first) sel.setSlug(first.slug);
    }
    // slugCategory/testCaseName close over the catalog; re-run as it resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, sel.slug, sel.cases, summaryBySlug, navSlug]);

  // Switching the type moves the case selection into the chosen category (unless
  // the current case already belongs to it) so the version and variant re-resolve
  // for a case the dropdown actually shows.
  function onCategoryChange(next: RunCategory) {
    setCategory(next);
    if (slugCategory(sel.slug) === next) return;
    const first = [...sel.cases]
      .filter((c) => slugCategory(c.slug) === next)
      .sort((a, b) => testCaseName(a.slug).localeCompare(testCaseName(b.slug)))[0];
    if (first) sel.setSlug(first.slug);
  }

  // The catalog arrives in slug order, but the dropdown labels each option with
  // the display name — so sort by resolved display name to keep the list
  // alphabetical as shown (otherwise e.g. "Carom" slots in where "pong" sits).
  // Scoped to the selected type so the list only offers cases of that category.
  const sortedCases = useMemo(
    () =>
      [...sel.cases]
        .filter((c) => slugCategory(c.slug) === activeCategory)
        .sort((a, b) =>
          testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
        ),
    // slugCategory closes over summaryBySlug; list depends on it and the category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel.cases, testCaseName, summaryBySlug, activeCategory],
  );

  // Catalog versions are oldest-first; show the dropdown newest-first.
  const versions = [
    ...(sel.cases.find((c) => c.slug === sel.slug)?.versions ?? []),
  ].reverse();
  // Orchestrator selection is limited to the program-building test types — the
  // end-to-end and full-stack game builds, whose multi-session harness runs can
  // be conducted by a non-default orchestrator (e.g. ralph). Every other type
  // always runs one-shot, so the selector is hidden and one-shot is submitted.
  const buildsProgram =
    sel.versionInfo?.testType === "end-to-end" ||
    sel.versionInfo?.testType === "full-stack";
  // Whatever the picker holds, only a program-building case may carry a
  // non-default orchestrator — otherwise the run is one-shot no matter what was
  // last chosen.
  const submittedOrchestrator = buildsProgram
    ? orchestrator
    : DEFAULT_ORCHESTRATOR_SLUG;
  const mismatched = worker?.backendMatch === "mismatch";
  // A remote (service-driven) worker enqueues on the backend's `POST /jobs`,
  // which is gated on the launching account — so a sign-in is required before a
  // run can be submitted. The built-in local (Tauri) worker runs in-process and
  // needs no token.
  const needsAuth = Boolean(worker && !worker.local);
  const signedOut = needsAuth && !token;
  // Every combination must name a harness and a model; a partially-filled row
  // would otherwise be silently skipped.
  const combosValid =
    combinations.length > 0 &&
    combinations.every((c) => c.harness && c.modelId);
  const totalLaunches = combinations.length * runCount;
  const canLaunch = Boolean(
    worker &&
    !mismatched &&
    !signedOut &&
    sel.slug &&
    sel.version &&
    sel.variant &&
    combosValid &&
    !launching,
  );

  async function onLaunch() {
    if (!worker) return;
    setLaunchError(null);
    setResults(null);
    setLaunching(true);
    // Fan out client-side: `runCount` launches per combination (total =
    // combinations × runCount), through the shared `launchBatch` (sequential, each
    // isolated so one failure never aborts the rest). Build the launch items and a
    // parallel array of display metadata, then zip the results back by index.
    const meta = combinations.flatMap((combo) =>
      Array.from({ length: runCount }, (_, i) => ({ combo, runIndex: i + 1 })),
    );
    const items: LaunchItem[] = meta.map(({ combo }) => ({
      config: {
        testCase: sel.slug,
        version: sel.version,
        variant: sel.variant,
        harness: combo.harness,
        modelId: resolveLaunchModel(
          combo.harness,
          combo.provider,
          combo.modelId,
        ),
        orchestrator: submittedOrchestrator,
        maxRuntimeOverride: maxRuntime ? Number(maxRuntime) : null,
        retryCount,
      },
      track: {
        testCaseSlug: sel.slug,
        testCaseVersion: sel.version,
        variant: sel.variant,
        harnessSlug: combo.harness,
        modelId: combo.modelId,
      },
    }));
    const launched = await launchBatch(worker, token, runtime.track, items);
    const outcomes: LaunchOutcome[] = meta.map((m, i) => {
      const result = launched[i];
      return {
        key: `${m.combo.id}#${m.runIndex}`,
        harness: m.combo.harness,
        modelId: m.combo.modelId,
        runIndex: m.runIndex,
        runId: result?.runId,
        error: result?.error,
      };
    });
    setLaunching(false);

    // Single-launch path is unchanged in feel: on success jump straight to the
    // live monitor; on failure surface the error inline as before.
    const only = outcomes.length === 1 ? outcomes[0] : undefined;
    if (only) {
      if (only.runId) {
        navigate(routes.runMonitor(only.runId));
        return;
      }
      setLaunchError(only.error ?? "Launch failed.");
      return;
    }
    // Batch path: keep the user here with a per-combination summary linking to
    // each launched run (and the runs list), so partial failures stay visible.
    setResults(outcomes);
  }

  return (
    <PageLayout>
      <PromptHeader
        command="--new-run"
        comment={<>// configure &amp; launch</>}
      />

      {!worker && (
        <p className={`${styles.notice} ${styles.warn}`}>
          No worker connected — open the connections drawer (the gear in the top
          bar) to add a worker server to run on.
        </p>
      )}
      {mismatched && (
        <p className={`${styles.notice} ${styles.error}`}>
          The active worker is bound to a different backend than this console is
          pointed at. Launching is disabled to avoid asking for a test case the
          worker can&rsquo;t resolve.
        </p>
      )}
      {sel.noBackend && (
        <p className={`${styles.notice} ${styles.warn}`}>
          No backend configured — the test-case catalog comes from the backend.
        </p>
      )}
      {signedOut && (
        <p className={`${styles.notice} ${styles.warn}`}>
          Sign in to launch a run — the backend attributes each enqueued run to
          your account. Use the account control in the top bar to register or
          log in, then launch.
        </p>
      )}

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Test case type</span>
          <select
            className={styles.select}
            value={activeCategory}
            onChange={(e) => onCategoryChange(e.target.value as RunCategory)}
          >
            {RUN_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Test case</span>
          <select
            className={styles.select}
            value={sel.slug}
            onChange={(e) => sel.setSlug(e.target.value)}
          >
            {sortedCases.map((c) => (
              <option key={c.slug} value={c.slug}>
                {testCaseName(c.slug)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Version</span>
          <select
            className={styles.select}
            value={sel.version}
            onChange={(e) => sel.setVersion(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Variant</span>
          <select
            className={styles.select}
            value={sel.variant}
            onChange={(e) => sel.setVariant(e.target.value)}
            disabled={!sel.versionInfo}
          >
            {(sel.versionInfo?.variants ?? []).map((v) => (
              <option key={v.slug} value={v.slug}>
                {v.name} ({v.slug})
              </option>
            ))}
          </select>
        </label>
        {buildsProgram && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Orchestrator</span>
            <select
              className={styles.select}
              value={orchestrator}
              onChange={(e) => setOrchestrator(e.target.value)}
              title={
                BUILT_IN_ORCHESTRATORS.find((o) => o.slug === orchestrator)
                  ?.description
              }
            >
              {BUILT_IN_ORCHESTRATORS.map((o) => (
                <option key={o.slug} value={o.slug} title={o.description}>
                  {o.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Max runtime (s, optional)</span>
          <input
            className={styles.input}
            type="number"
            min={1}
            value={maxRuntime}
            onChange={(e) => setMaxRuntime(e.target.value)}
            placeholder={
              sel.versionInfo
                ? `default ${sel.versionInfo.maxRuntimeSeconds}`
                : "default"
            }
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Run count</span>
          <input
            className={styles.input}
            type="number"
            min={1}
            max={RUN_COUNT_MAX}
            step={1}
            value={runCount}
            onChange={(e) => {
              // Clamp to a sane integer range so an accidental keystroke can't
              // enqueue an absurd batch; a blank/invalid entry falls back to 1.
              const n = Math.floor(Number(e.target.value));
              setRunCount(
                Number.isFinite(n) && n >= 1 ? Math.min(n, RUN_COUNT_MAX) : 1,
              );
            }}
          />
        </label>
        <label
          className={styles.field}
          title="Auto-retries on infra error or catastrophic failure (not on a validation error, timeout, or a completed run)."
        >
          <span className={styles.fieldLabel}>Retry count</span>
          <input
            className={styles.input}
            type="number"
            min={0}
            max={RETRY_COUNT_MAX}
            step={1}
            value={retryCount}
            onChange={(e) => {
              // Clamp to [0, RETRY_COUNT_MAX] (matching the backend); a blank/invalid
              // entry falls back to the default of one retry.
              const n = Math.floor(Number(e.target.value));
              setRetryCount(
                Number.isFinite(n) && n >= 0
                  ? Math.min(n, RETRY_COUNT_MAX)
                  : DEFAULT_RETRY_COUNT,
              );
            }}
          />
        </label>
      </div>

      <p className={`${styles.sectionLabel} ${styles.sectionLabelBackdrop}`}>
        Harness / model combinations
      </p>
      <div className={styles.comboList}>
        {combinations.map((combo) => (
          <div key={combo.id} className={styles.comboRow}>
            <label className={`${styles.field} ${styles.comboField}`}>
              <span className={styles.fieldLabel}>Harness</span>
              <select
                className={styles.select}
                value={combo.harness}
                onChange={(e) =>
                  // A model slug is family-specific, so switching harness clears
                  // the selection — the operator must explicitly pick a model the
                  // new harness can launch rather than inherit a silent default.
                  updateCombination(combo.id, {
                    harness: e.target.value,
                    modelId: "",
                  })
                }
              >
                {harnesses.map((h) => (
                  <option key={h.slug} value={h.slug}>
                    {h.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${styles.field} ${styles.comboFieldWide}`}>
              <span className={styles.fieldLabel}>Model</span>
              <ModelCombobox
                value={combo.modelId}
                onChange={(v) => updateCombination(combo.id, { modelId: v })}
                models={models}
                harnessFamily={familyOf(combo.harness)}
                inputClassName={styles.input}
                placeholder="model id (e.g. claude-opus-4-8)"
              />
            </label>
            {harnessUsesProvider(combo.harness) && (
              <label className={`${styles.field} ${styles.comboField}`}>
                <span className={styles.fieldLabel}>Provider</span>
                <select
                  className={styles.select}
                  value={combo.provider}
                  onChange={(e) =>
                    updateCombination(combo.id, { provider: e.target.value })
                  }
                  title="How this harness reaches the model — the model id is launched with this provider's routing prefix."
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className={styles.comboRemove}
              onClick={() => removeCombination(combo.id)}
              disabled={combinations.length <= 1}
              aria-label="Remove combination"
              title="Remove combination"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          onClick={addCombination}
        >
          + Add combination
        </button>
        <div className={styles.actionsEnd}>
          {sel.loading && (
            <span className={styles.muted}>resolving version…</span>
          )}
          <button
            className={styles.primary}
            onClick={onLaunch}
            disabled={!canLaunch}
          >
            {launching
              ? "Launching…"
              : totalLaunches > 1
                ? `Launch ${totalLaunches} runs`
                : "Launch run"}
          </button>
        </div>
      </div>

      {results && (
        <div className={styles.launchResults}>
          <p className={`${styles.sectionLabel} ${styles.sectionLabelBackdrop}`}>
            Launched {results.filter((o) => o.runId).length} of {results.length}
          </p>
          <ul className={styles.resultList}>
            {results.map((o) => (
              <li
                key={o.key}
                className={`${styles.resultRow} ${
                  o.runId ? styles.resultOk : styles.resultFail
                }`}
              >
                <span className={styles.resultLabel}>
                  {harnessName(o.harness)} · {o.modelId}
                  {runCount > 1 ? ` · #${o.runIndex}` : ""}
                </span>
                {o.runId ? (
                  <Link
                    className={styles.resultLink}
                    to={routes.runMonitor(o.runId)}
                  >
                    view run →
                  </Link>
                ) : (
                  <span className={styles.resultError}>{o.error}</span>
                )}
              </li>
            ))}
          </ul>
          <Link className={styles.muted} to={routes.runs()}>
            Go to runs list →
          </Link>
        </div>
      )}

      {(launchError || sel.error) && (
        <p className={`${styles.notice} ${styles.error}`}>
          {launchError ?? sel.error}
        </p>
      )}
    </PageLayout>
  );
}
