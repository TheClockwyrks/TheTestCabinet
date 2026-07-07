import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../../../client/auth";
import { useBackend, useWorkers } from "../../../client/context";
import type { Model } from "../../../client/types";
import { harnesses } from "../../data/harnesses";
import {
  BUILT_IN_ORCHESTRATORS,
  DEFAULT_ORCHESTRATOR_SLUG,
} from "../../data/orchestrators";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import { useCatalog } from "../../runtime/useCatalog";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import styles from "./RunExec.module.scss";

// Configure and launch a run, then hand off to the live monitor. The catalog
// (cases, harnesses, models) comes from the active backend; the run is submitted
// to the active worker. This is the routed home of the old console Run screen's
// configuration half — the event stream now lives on the monitor page.
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
  const sel = useCatalog({
    slug: params.get("slug"),
    version: params.get("version"),
    variant: params.get("variant"),
  });
  const testCaseName = useTestCaseName();

  const [models, setModels] = useState<Model[]>([]);
  // Harnesses are a fixed, code-defined catalog (not backend-served): default to
  // the first and let the picker choose among them.
  const [harness, setHarness] = useState(harnesses[0]?.slug ?? "");
  // The orchestrator that conducts the harness sessions. Selectable only for the
  // end-to-end test type (the selector below is hidden otherwise); every other
  // test type always submits the default `one-shot`. Built-in slugs only — the
  // worker has no access to a submitter's local orchestrator directory.
  const [orchestrator, setOrchestrator] = useState(DEFAULT_ORCHESTRATOR_SLUG);
  const [modelId, setModelId] = useState("");
  const [maxRuntime, setMaxRuntime] = useState("");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    if (!backend) return;
    backend
      .listModels()
      .then((ms) => {
        setModels(ms);
        const firstId = ms[0]?.modelIds[0] ?? ms[0]?.slug ?? "";
        if (firstId) setModelId(firstId);
      })
      .catch(() => {
        // The model catalog is optional; leave the field free-text.
      });
  }, [backend]);

  const versions = sel.cases.find((c) => c.slug === sel.slug)?.versions ?? [];
  // Orchestrator selection is limited to the end-to-end test type; other types
  // always run one-shot, so the selector is hidden and one-shot is submitted.
  const isEndToEnd = sel.versionInfo?.testType === "end-to-end";
  // Whatever the picker holds, only an end-to-end case may carry a non-default
  // orchestrator — otherwise the run is one-shot no matter what was last chosen.
  const submittedOrchestrator = isEndToEnd
    ? orchestrator
    : DEFAULT_ORCHESTRATOR_SLUG;
  const mismatched = worker?.backendMatch === "mismatch";
  // A remote (service-driven) worker enqueues on the backend's `POST /jobs`,
  // which is gated on the launching account — so a sign-in is required before a
  // run can be submitted. The built-in local (Tauri) worker runs in-process and
  // needs no token.
  const needsAuth = Boolean(worker && !worker.local);
  const signedOut = needsAuth && !token;
  const canLaunch = Boolean(
    worker &&
      !mismatched &&
      !signedOut &&
      sel.slug &&
      sel.version &&
      sel.variant &&
      harness &&
      modelId &&
      !launching,
  );

  async function onLaunch() {
    if (!worker) return;
    setLaunchError(null);
    setLaunching(true);
    try {
      const runId = await worker.client.launchRun(
        {
          testCase: sel.slug,
          version: sel.version,
          variant: sel.variant,
          harness,
          modelId,
          orchestrator: submittedOrchestrator,
          maxRuntimeOverride: maxRuntime ? Number(maxRuntime) : null,
        },
        token,
      );
      runtime.track({
        runId,
        testCaseSlug: sel.slug,
        testCaseVersion: sel.version,
        variant: sel.variant,
        harnessSlug: harness,
        modelId,
        state: "running",
      });
      navigate(routes.runMonitor(runId));
    } catch (e) {
      setLaunchError(String(e));
      setLaunching(false);
    }
  }

  return (
    <PageLayout>
      <PromptHeader command="--new-run" comment={<>// configure &amp; launch</>} />

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
          your account. Use the account control in the top bar to register or log
          in, then launch.
        </p>
      )}

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Test case</span>
          <select
            className={styles.select}
            value={sel.slug}
            onChange={(e) => sel.setSlug(e.target.value)}
          >
            {sel.cases.map((c) => (
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
          <span className={styles.fieldLabel}>Harness</span>
          <select
            className={styles.select}
            value={harness}
            onChange={(e) => setHarness(e.target.value)}
          >
            {harnesses.map((h) => (
              <option key={h.slug} value={h.slug}>
                {h.displayName}
              </option>
            ))}
          </select>
        </label>
        {isEndToEnd && (
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
          <span className={styles.fieldLabel}>Model</span>
          <input
            className={styles.input}
            list="tcab-model-ids"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="model id (e.g. claude-opus-4-8)"
          />
          <datalist id="tcab-model-ids">
            {models.flatMap((m) =>
              m.modelIds.map((id) => <option key={id} value={id} />),
            )}
          </datalist>
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
      </div>

      <div className={styles.actions}>
        <button
          className={styles.primary}
          onClick={onLaunch}
          disabled={!canLaunch}
        >
          {launching ? "Launching…" : "Launch run"}
        </button>
        {sel.loading && (
          <span className={styles.muted}>resolving version…</span>
        )}
      </div>

      {(launchError || sel.error) && (
        <p className={`${styles.notice} ${styles.error}`}>
          {launchError ?? sel.error}
        </p>
      )}
    </PageLayout>
  );
}
