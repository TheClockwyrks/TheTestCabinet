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
  isGgOrchestrator,
} from "../../data/orchestrators";
import { bindModelSlots, launchModelSlots } from "./gg/ggConfigDraft";
import { PRIMARY_SLOT } from "./gg/ggCatalog";
import { useGgConfigs } from "./gg/useGgConfigs";
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
import { useCatalog } from "../../runtime/useCatalog";
import { useCaseCategory } from "../../runtime/useCaseCategory";
import { useTestCaseName } from "../../data/useTestCaseName";
import { GG_HARNESS_SLUG } from "../../data/runLinks";
import {
  CATALOG_CATEGORIES,
  type CatalogCategory,
} from "../../data/testCaseTabs";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import styles from "./RunExec.module.scss";

// One harness/model[/provider] combination to launch. The test (case, version,
// variant, orchestrator, max runtime) is shared across all combinations; each
// combination varies the harness and model (and, for provider-routed harnesses,
// the provider) so a single form submission can fan out across many runs.
//
// A gg run varies the same way, except the configuration stands where the harness
// does: `ggConfig` names the saved (or built-in) capability set the row launches,
// and the row supplies a model for each *model slot* that configuration declares —
// so the same fan-out spans configurations × models, which is exactly the sweep a study
// comparing two configurations runs. A role the configuration pinned to a model itself is
// not asked about here.
interface Combination {
  /** A stable client-side key so React and per-row edits track the right row. */
  id: string;
  harness: string;
  /** The picked gg configuration's key (see `useGgConfigs`); gg runs only. */
  ggConfig: string;
  modelId: string;
  /**
   * The model bound to each of the gg configuration's declared model slots, keyed by
   * slot name; gg runs only. Seeded from each slot's declared default.
   */
  slotModels: Record<string, string>;
  provider: string;
}

// The result of attempting to launch one combination. `runId` is set on success
// (and links to the live monitor); `error` on failure. Partial results are the
// norm — one combination failing must not abort the rest.
interface LaunchOutcome {
  key: string;
  /** How the row read: the harness's display name, or the gg configuration's. */
  label: string;
  /** Where the launched run is watched — the conventional monitor, or gg's. */
  monitorPath?: string;
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
    ggConfig: "",
    modelId: "",
    slotModels: {},
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
  // The test type → test case split: the type selector over `useCatalog`'s case
  // picker, scoping the case dropdown to the chosen type and opening on the
  // navigated-to case's type when there is one.
  const {
    category: activeCategory,
    setCategory: onCategoryChange,
    cases: sortedCases,
  } = useCaseCategory(sel, { navSlug });

  const [models, setModels] = useState<Model[]>([]);
  // The orchestrator that conducts the harness sessions — and, since it is where an
  // operator says *how* a run is conducted, also where gg (The Test Cabinet's own
  // run mode) is chosen. Built-in slugs only — the worker has no access to a
  // submitter's local orchestrator directory.
  const [orchestrator, setOrchestrator] = useState(DEFAULT_ORCHESTRATOR_SLUG);
  // The gg configurations this operator can launch: the shared read-only built-ins
  // plus the ones registered on their account (the account section's gg tab). Only
  // consulted when gg is the chosen run mode.
  const { options: ggOptions } = useGgConfigs();
  const isGg = isGgOrchestrator(orchestrator);
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

  // The gg configuration a row launches, and the launch inputs it still needs — the
  // model slots it declares that no role pins itself. Memoized per configuration key
  // so the per-row rendering does not re-derive them every keystroke.
  const ggOptionFor = (key: string) => ggOptions.find((o) => o.key === key);
  const ggSlotsByKey = useMemo(
    () =>
      new Map(
        ggOptions.map(
          (o) => [o.key, launchModelSlots(o.capabilitySet)] as const,
        ),
      ),
    [ggOptions],
  );
  const ggSlotsFor = (key: string) => ggSlotsByKey.get(key) ?? [];
  // A row's models seeded from the configuration's declared defaults, so picking a
  // configuration that names its models opens ready to launch.
  const defaultSlotModels = (key: string): Record<string, string> =>
    Object.fromEntries(
      ggSlotsFor(key).map((slot) => [slot.name, slot.defaultModelId ?? ""]),
    );

  function updateCombination(id: string, patch: Partial<Combination>) {
    setCombinations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }
  // Switching a row's configuration re-seeds its models: the slots a configuration
  // declares are its own, so carrying the previous one's picks over would bind models
  // to slots that no longer exist (and silently drop the ones that do).
  function setGgConfig(id: string, key: string) {
    updateCombination(id, {
      ggConfig: key,
      slotModels: defaultSlotModels(key),
    });
  }
  function setSlotModel(id: string, slot: string, modelId: string) {
    setCombinations((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, slotModels: { ...c.slotModels, [slot]: modelId } }
          : c,
      ),
    );
  }
  function addCombination() {
    setCombinations((prev) => {
      const next = makeCombination(`c${nextComboId.current++}`);
      // Seed the new row with the last row's harness (or gg configuration) —
      // fanning out across models for one of them is the common case, so carry it
      // forward rather than resetting to the first (the model still starts empty to
      // force an explicit pick).
      const last = prev[prev.length - 1];
      return [
        ...prev,
        last
          ? {
              ...next,
              harness: last.harness,
              ggConfig: last.ggConfig,
              slotModels: defaultSlotModels(last.ggConfig),
            }
          : next,
      ];
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
  // What a row reads as in the launch summary: its gg configuration when the run
  // mode is gg, otherwise its harness.
  const comboLabel = (combo: Combination) =>
    isGg
      ? (ggOptionFor(combo.ggConfig)?.name ?? "gg")
      : harnessName(combo.harness);
  // How a gg row's models read in the launch summary: the primary model, plus a count
  // of the other slots it bound (a multi-model row is not one model id).
  const ggModelLabel = (combo: Combination) => {
    const slots = ggSlotsFor(combo.ggConfig);
    const primary = combo.slotModels[PRIMARY_SLOT] ?? "";
    const rest = slots.filter((s) => s.name !== PRIMARY_SLOT).length;
    const head =
      primary ||
      slots.map((s) => combo.slotModels[s.name]).find(Boolean) ||
      "—";
    return rest > 0 ? `${head} +${rest}` : head;
  };

  // Seed each row's gg configuration once gg is chosen (and the configurations have
  // loaded), so the picker opens on the launchable default instead of a blank row —
  // with that configuration's declared model defaults already filled in.
  useEffect(() => {
    if (!isGg || ggOptions.length === 0) return;
    const first = ggOptions[0]!;
    const seeded = Object.fromEntries(
      launchModelSlots(first.capabilitySet).map((slot) => [
        slot.name,
        slot.defaultModelId ?? "",
      ]),
    );
    setCombinations((prev) =>
      prev.some((c) => !c.ggConfig)
        ? prev.map((c) =>
            c.ggConfig
              ? c
              : { ...c, ggConfig: first.key, slotModels: { ...seeded } },
          )
        : prev,
    );
  }, [isGg, ggOptions]);

  // Catalog versions are oldest-first; show the dropdown newest-first.
  const versions = [
    ...(sel.cases.find((c) => c.slug === sel.slug)?.versions ?? []),
  ].reverse();
  const mismatched = worker?.backendMatch === "mismatch";
  // A remote (service-driven) worker enqueues on the backend's `POST /jobs`,
  // which is gated on the launching account — so a sign-in is required before a
  // run can be submitted. The built-in local (Tauri) worker runs in-process and
  // needs no token.
  const needsAuth = Boolean(worker && !worker.local);
  const signedOut = needsAuth && !token;
  // Every combination must name a harness and a model — or, in the gg run mode, a
  // configuration plus a model for every slot that configuration asks for. A
  // partially-filled row would otherwise be silently skipped (or, for gg, rejected by
  // the backend after the operator had left the form).
  const ggRowReady = (combo: Combination) =>
    Boolean(combo.ggConfig) &&
    ggSlotsFor(combo.ggConfig).every((slot) =>
      (combo.slotModels[slot.name] ?? "").trim(),
    );
  const combosValid =
    combinations.length > 0 &&
    combinations.every((c) => (isGg ? ggRowReady(c) : c.harness && c.modelId));
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

  // Enqueue the fan-out as **gg** runs. gg is its own run mode with its own
  // request shape (a capability set rather than a harness/model/orchestrator
  // tuple), so it has no batch endpoint: each launch is its own `POST /gg/runs`,
  // isolated so one failure never aborts the rest. The row's configuration supplies
  // the capability set and the row's model binds its primary slot.
  async function launchGgRuns(
    meta: { combo: Combination; runIndex: number }[],
  ): Promise<LaunchOutcome[]> {
    const outcomes: LaunchOutcome[] = [];
    for (const { combo, runIndex } of meta) {
      const option = ggOptionFor(combo.ggConfig);
      const base: Omit<LaunchOutcome, "runId" | "error"> = {
        key: `${combo.id}#${runIndex}`,
        label: comboLabel(combo),
        modelId: ggModelLabel(combo),
        runIndex,
      };
      if (!option) {
        outcomes.push({ ...base, error: "that gg configuration is gone" });
        continue;
      }
      try {
        // The set that actually runs: every deferred agent bound to the model its
        // slot collected. Its root (`agents[0]`) carries the run's representative
        // model — the same one the backend lifts into the job's launch identity —
        // so what is tracked below matches what a reload re-seeds from `/jobs/active`.
        const capabilitySet = bindModelSlots(
          option.capabilitySet,
          combo.slotModels,
        );
        const ack = await worker!.client.launchGgRun(
          {
            testCase: sel.slug,
            version: sel.version,
            variant: sel.variant,
            capabilitySet,
            // Omit the override entirely when blank so the case's default runtime
            // applies (the field is optional, not nullable).
            ...(maxRuntime ? { maxRuntimeSeconds: Number(maxRuntime) } : {}),
            retryCount,
          },
          token ?? "",
        );
        // Register the enqueued run with the runs runtime exactly as `launchBatch`
        // does for a harness run: gg has no batch endpoint, so it does not travel
        // through that shared path and has to track its own. Without this a gg run
        // is missing from the Runs page's in-progress list for its whole life —
        // and, since the reconcile backstop only polls while something is tracked,
        // nothing recovers it until the page is reloaded and the list re-seeds from
        // the backend's active jobs.
        runtime.track({
          testCaseSlug: sel.slug,
          testCaseVersion: sel.version,
          variant: sel.variant,
          harnessSlug: GG_HARNESS_SLUG,
          modelId: capabilitySet.agents?.[0]?.modelId ?? "",
          // Read off the set that was actually sent rather than the picker option,
          // so the configuration name the row shows now is byte-identical to the one
          // the backend will lift back out of the job's stored capability set when
          // the reconcile re-seeds this row from `/jobs/active`.
          ggPreset: capabilitySet.preset ?? null,
          runId: ack.jobId,
          // Just enqueued: `queued` on the backend, advanced by the reconcile as it
          // reports each transition.
          state: "queued",
        });
        // A gg run is watched on its own monitor, keyed by the enqueued job id.
        outcomes.push({
          ...base,
          runId: ack.jobId,
          monitorPath: routes.ggMonitor(ack.jobId),
        });
      } catch (e) {
        outcomes.push({
          ...base,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return outcomes;
  }

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
    if (isGg) {
      const ggOutcomes = await launchGgRuns(meta);
      setLaunching(false);
      finishLaunch(ggOutcomes);
      return;
    }
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
        orchestrator,
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
        label: comboLabel(m.combo),
        modelId: m.combo.modelId,
        runIndex: m.runIndex,
        runId: result?.runId,
        monitorPath: result?.runId
          ? routes.runMonitor(result.runId)
          : undefined,
        error: result?.error,
      };
    });
    setLaunching(false);
    finishLaunch(outcomes);
  }

  // What to do once every launch has been attempted, shared by both run modes: a
  // single launch is unchanged in feel — jump straight to the live monitor (gg's
  // own, for a gg run) on success, surface the error inline on failure — while a
  // batch keeps the operator here with a per-combination summary so partial
  // failures stay visible.
  function finishLaunch(outcomes: LaunchOutcome[]) {
    const only = outcomes.length === 1 ? outcomes[0] : undefined;
    if (only) {
      if (only.monitorPath) {
        navigate(only.monitorPath);
        return;
      }
      setLaunchError(only.error ?? "Launch failed.");
      return;
    }
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
            onChange={(e) =>
              onCategoryChange(e.target.value as CatalogCategory)
            }
          >
            {CATALOG_CATEGORIES.map((c) => (
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
            {/* Every built-in session strategy (today just `one-shot`) applies to
                every test type, and gg is orthogonal to the session strategy, so
                the picker offers the same options whatever the case builds. */}
            {BUILT_IN_ORCHESTRATORS.map((o) => (
              <option key={o.slug} value={o.slug} title={o.description}>
                {o.displayName}
              </option>
            ))}
          </select>
        </label>
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
          title="Auto-retries on infra error or catastrophic failure (not on a timeout or a completed run)."
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
        {isGg ? "gg configuration" : "Harness / model combinations"}
      </p>
      <div className={styles.comboList}>
        {combinations.map((combo) => {
          const remove = (
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
          );

          // A gg row is a stack rather than a line. A configuration declares one model
          // slot per agent profile it does not pin itself, so the row holds an unbounded
          // number of pickers — laid out beside the configuration they squeeze every one of
          // them below the width a model id is legible in, and the row reflows differently
          // for every configuration. So the configuration leads its own line, and each slot
          // gets a row to itself beneath it.
          if (isGg) {
            return (
              <div
                key={combo.id}
                className={`${styles.comboRow} ${styles.comboRowStacked}`}
              >
                <div className={styles.comboHead}>
                  <label className={`${styles.field} ${styles.comboField}`}>
                    <span className={styles.fieldLabel}>gg configuration</span>
                    <select
                      className={styles.select}
                      value={combo.ggConfig}
                      onChange={(e) => setGgConfig(combo.id, e.target.value)}
                      title={ggOptionFor(combo.ggConfig)?.description}
                    >
                      {ggOptions.length === 0 && (
                        <option value="">(loading…)</option>
                      )}
                      {ggOptions.map((o) => (
                        <option key={o.key} value={o.key} title={o.description}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {remove}
                </div>
                {/* One picker per model slot the chosen configuration declares, in
                    declaration order, pre-filled with that slot's default. gg reaches
                    every slot's model through OpenRouter, so each picker is scoped to
                    that family and commits the OpenRouter slug. */}
                {ggSlotsFor(combo.ggConfig).map((slot) => (
                  <label
                    key={slot.name}
                    className={`${styles.field} ${styles.comboSlotField}`}
                  >
                    <span className={styles.fieldLabel}>{slot.name}</span>
                    <ModelCombobox
                      value={combo.slotModels[slot.name] ?? ""}
                      onChange={(v) => setSlotModel(combo.id, slot.name, v)}
                      models={models}
                      harnessFamily={familyOf("gg")}
                      inputClassName={styles.input}
                      placeholder="model id (e.g. anthropic/claude-opus-4.8)"
                    />
                  </label>
                ))}
              </div>
            );
          }

          return (
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
              {remove}
            </div>
          );
        })}
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
          <p
            className={`${styles.sectionLabel} ${styles.sectionLabelBackdrop}`}
          >
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
                  {o.label} · {o.modelId}
                  {runCount > 1 ? ` · #${o.runIndex}` : ""}
                </span>
                {o.monitorPath ? (
                  <Link className={styles.resultLink} to={o.monitorPath}>
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
