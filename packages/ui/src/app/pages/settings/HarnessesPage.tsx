import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel, SegmentedControl } from "@test-cabinet/ui";
import { LoadingState } from "../../components/LoadingState";
import { SettingsLayout } from "../../layouts/settings/SettingsLayout";
import {
  useGalleryData,
  type HarnessAuth,
  type HarnessAuthApi,
  type HarnessAuthMode,
} from "../../data/galleryContext";
import { useHarnessConfig, type HarnessConfigApi } from "../../data/useHarnessConfig";
import type { HarnessConfigEntry } from "../../../client/types";
import styles from "./HarnessesPage.module.scss";

// The Harnesses settings tab (`/settings/harnesses`). It folds together two
// per-harness concerns:
//
//   • **Parallelism** — how many runs of a harness the Test Cabinet drives at once —
//     which is backend-backed (the backend's claim enforces it by holding surplus
//     runs `pending`), so it works on both the web console and the desktop app.
//   • **Authentication** — the run credentials (method, API key, subscription
//     files) — which is a Tauri-only host-local concern (the desktop shell writes
//     them into the local cluster from the signed-in host CLIs). There is no safe
//     cluster path to set these from the web UI, so these controls are shown only
//     where the `harnessAuth` capability exists (the desktop app) and are hidden in
//     the web console.
//
// Each harness gets one card carrying whichever of the two are available here.
export function HarnessesPage() {
  const config = useHarnessConfig();
  const { harnessAuth } = useGalleryData();
  if (!config && !harnessAuth) {
    // Reached only if the route mounted without either capability (e.g. a
    // read-only host); keep the page honest rather than blank.
    return (
      <SettingsLayout tab="harnesses">
        <Panel>
          <p className={styles.muted}>
            Harness configuration isn&rsquo;t available on this host.
          </p>
        </Panel>
      </SettingsLayout>
    );
  }
  return <HarnessesBody config={config} auth={harnessAuth ?? null} />;
}

// One harness's merged settings row, keyed by slug: whichever of its config and
// auth state are available here.
interface MergedHarness {
  slug: string;
  name: string;
  config: HarnessConfigEntry | null;
  auth: HarnessAuth | null;
}

function HarnessesBody({
  config,
  auth,
}: {
  config: HarnessConfigApi | null;
  auth: HarnessAuthApi | null;
}) {
  const [configs, setConfigs] = useState<HarnessConfigEntry[] | null>(null);
  const [auths, setAuths] = useState<HarnessAuth[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The slug of the harness whose request is in flight, to disable its controls.
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (config) {
      config
        .list()
        .then((list) => active && setConfigs(list))
        .catch((e) => active && setError(String(e)));
    } else {
      setConfigs([]);
    }
    return () => {
      active = false;
    };
  }, [config]);

  useEffect(() => {
    let active = true;
    if (auth) {
      auth
        .list()
        .then((list) => active && setAuths(list))
        .catch((e) => active && setError(String(e)));
    } else {
      setAuths([]);
    }
    return () => {
      active = false;
    };
  }, [auth]);

  // Run one mutation, adopt its refreshed list, and gate the card while it is in
  // flight. Errors surface inline. `adopt` writes the refreshed list back to the
  // right piece of state (config vs. auth), so either half updates independently.
  const run = useCallback(
    async <T,>(slug: string, op: () => Promise<T>, adopt: (result: T) => void) => {
      setBusy(slug);
      setError(null);
      try {
        adopt(await op());
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  // The union of both sources, preserving the config order (the backend enumerates
  // every harness in a stable order) and appending any auth-only slugs after it.
  const merged = useMemo<MergedHarness[] | null>(() => {
    if (configs === null || auths === null) return null;
    const configBySlug = new Map(configs.map((c) => [c.slug, c]));
    const authBySlug = new Map(auths.map((a) => [a.slug, a]));
    const slugs: string[] = [];
    for (const c of configs) slugs.push(c.slug);
    for (const a of auths) if (!configBySlug.has(a.slug)) slugs.push(a.slug);
    return slugs.map((slug) => {
      const c = configBySlug.get(slug) ?? null;
      const a = authBySlug.get(slug) ?? null;
      return { slug, name: c?.name ?? a?.name ?? slug, config: c, auth: a };
    });
  }, [configs, auths]);

  const canEditLimit = config?.setMaxParallelism != null;

  return (
    <SettingsLayout tab="harnesses">
      <Panel className={styles.intro}>
        <p className={styles.muted}>
          Tune how each harness runs. <strong>Max parallelism</strong> caps how
          many runs of a harness the Test Cabinet drives at once — extra runs wait
          as <em>pending</em> until a slot frees.
          {auth ? (
            <>
              {" "}
              <strong>Authentication</strong> chooses how each harness authenticates
              the runs you launch on the local cluster; keys are stored on this
              machine and applied to the cluster.
            </>
          ) : null}
        </p>
      </Panel>

      {config && !canEditLimit && (
        <Panel className={styles.intro}>
          <p className={styles.muted}>
            Sign in to change a harness&rsquo;s maximum parallelism.
          </p>
        </Panel>
      )}

      {error && (
        <Panel className={styles.errorPanel}>
          <p className={styles.error}>{error}</p>
        </Panel>
      )}

      {merged === null && !error && (
        <Panel>
          <LoadingState size="section" label="Loading harnesses…" />
        </Panel>
      )}

      {merged?.map((harness) => (
        <HarnessCard
          key={harness.slug}
          harness={harness}
          busy={busy === harness.slug}
          canEditLimit={canEditLimit}
          onSaveLimit={(value) =>
            config?.setMaxParallelism &&
            run(
              harness.slug,
              () => config.setMaxParallelism!(harness.slug, value),
              setConfigs,
            )
          }
          onSetMode={(mode) =>
            auth &&
            run(harness.slug, () => auth.setAuthMode(harness.slug, mode), setAuths)
          }
          onSetKey={(key) =>
            auth &&
            run(harness.slug, () => auth.setApiKey(harness.slug, key), setAuths)
          }
          onRefresh={() =>
            auth &&
            run(
              harness.slug,
              () => auth.refreshSubscription(harness.slug),
              setAuths,
            )
          }
        />
      ))}
    </SettingsLayout>
  );
}

const READINESS: Record<string, { label: string; tone?: string }> = {
  ready: { label: "Ready", tone: styles.toneOk },
  "needs-key": { label: "Needs an API key", tone: styles.toneWarn },
  "needs-sign-in": { label: "Needs sign-in", tone: styles.toneWarn },
  "needs-credentials": { label: "Needs credentials", tone: styles.toneWarn },
  unsupported: { label: "Unsupported", tone: styles.toneMuted },
};

function HarnessCard({
  harness,
  busy,
  canEditLimit,
  onSaveLimit,
  onSetMode,
  onSetKey,
  onRefresh,
}: {
  harness: MergedHarness;
  busy: boolean;
  canEditLimit: boolean;
  onSaveLimit: (value: number | null) => void;
  onSetMode: (mode: HarnessAuthMode) => void;
  onSetKey: (key: string | null) => void;
  onRefresh: () => void;
}) {
  const { config, auth } = harness;
  const readiness = auth
    ? (READINESS[auth.readiness] ?? {
        label: auth.readiness,
        tone: styles.toneMuted,
      })
    : null;

  return (
    <Panel className={styles.card}>
      <header className={styles.cardHead}>
        <div>
          <h2 className={styles.title}>{harness.name}</h2>
          <p className={styles.slug}>{harness.slug}</p>
        </div>
        {readiness && (
          <span className={`${styles.badge} ${readiness.tone ?? ""}`}>
            {readiness.label}
          </span>
        )}
      </header>

      {config && (
        <ParallelismRow
          entry={config}
          busy={busy}
          canEdit={canEditLimit}
          onSave={onSaveLimit}
        />
      )}

      {auth && (
        <AuthRows
          harness={auth}
          busy={busy}
          onSetMode={onSetMode}
          onSetKey={onSetKey}
          onRefresh={onRefresh}
        />
      )}
    </Panel>
  );
}

// The max-parallelism control: a small number field with Save, or a read-only
// value + hint when the session can't edit it. An empty value means "no limit".
function ParallelismRow({
  entry,
  busy,
  canEdit,
  onSave,
}: {
  entry: HarnessConfigEntry;
  busy: boolean;
  canEdit: boolean;
  onSave: (value: number | null) => void;
}) {
  const current = entry.maxParallelism;
  const [draft, setDraft] = useState<string>(
    current == null ? "" : String(current),
  );
  // Re-sync the draft when the saved value changes underneath (e.g. after a save
  // that returned the refreshed list, or a switch between harnesses).
  useEffect(() => {
    setDraft(current == null ? "" : String(current));
  }, [current]);

  const trimmed = draft.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const valid =
    parsed === null || (Number.isInteger(parsed) && parsed >= 1);
  const changed =
    (current == null ? "" : String(current)) !== trimmed;

  return (
    <section className={styles.row}>
      <div className={styles.label}>
        <span className={styles.rowTitle}>Max parallelism</span>
        <span className={styles.hint}>
          {current == null
            ? "No limit — runs of this harness are dispatched as capacity allows."
            : `At most ${current} run${current === 1 ? "" : "s"} of this harness at once.`}
        </span>
      </div>
      {canEdit ? (
        <form
          className={styles.keyForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || !valid || !changed) return;
            onSave(parsed);
          }}
        >
          <input
            className={styles.input}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={draft}
            disabled={busy}
            placeholder="No limit"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className={styles.primary}
            type="submit"
            disabled={busy || !valid || !changed}
          >
            Save
          </button>
        </form>
      ) : (
        <span className={styles.hint}>
          {current == null ? "No limit" : `Limit: ${current}`}
        </span>
      )}
    </section>
  );
}

// The Tauri-only authentication controls (method / API key / subscription files),
// lifted verbatim from the previous Authentication page. Only rendered on a host
// that supplies the `harnessAuth` capability (the desktop app).
function AuthRows({
  harness,
  busy,
  onSetMode,
  onSetKey,
  onRefresh,
}: {
  harness: HarnessAuth;
  busy: boolean;
  onSetMode: (mode: HarnessAuthMode) => void;
  onSetKey: (key: string | null) => void;
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState("");

  // Only the methods this harness actually supports are offered (the control has
  // no disabled state); Auto is always available.
  const modeOptions: { value: HarnessAuthMode; label: string }[] = [
    { value: "auto", label: "Auto" },
  ];
  if (harness.supportsSubscription)
    modeOptions.push({ value: "subscription", label: "Subscription" });
  if (harness.supportsApiKey)
    modeOptions.push({ value: "api-key", label: "API key" });

  return (
    <>
      <section className={styles.row}>
        <div className={styles.label}>
          <span className={styles.rowTitle}>Method</span>
          <span className={styles.hint}>How this harness authenticates runs.</span>
        </div>
        {modeOptions.length > 1 ? (
          <SegmentedControl
            ariaLabel={`${harness.name} authentication method`}
            value={harness.selectedMode}
            onChange={(value) => !busy && onSetMode(value)}
            options={modeOptions}
          />
        ) : (
          <span className={styles.hint}>No selectable methods.</span>
        )}
      </section>

      {harness.supportsApiKey && (
        <section className={styles.row}>
          <div className={styles.label}>
            <span className={styles.rowTitle}>API key</span>
            <span className={styles.hint}>{apiKeySourceText(harness)}</span>
          </div>
          <form
            className={styles.keyForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (busy || !draft.trim()) return;
              onSetKey(draft.trim());
              setDraft("");
            }}
          >
            <input
              className={styles.input}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              disabled={busy}
              placeholder={
                harness.apiKeySet ? "Replace key…" : `Set ${harness.apiKeyEnv}`
              }
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              className={styles.primary}
              type="submit"
              disabled={busy || !draft.trim()}
            >
              Save
            </button>
            {harness.apiKeySource === "override" && (
              <button
                className={styles.secondary}
                type="button"
                disabled={busy}
                onClick={() => onSetKey(null)}
              >
                Clear
              </button>
            )}
          </form>
        </section>
      )}

      {harness.supportsSubscription && (
        <section className={styles.row}>
          <div className={styles.label}>
            <span className={styles.rowTitle}>Subscription</span>
            <span className={styles.hint}>
              Sign in with the harness CLI on this machine, then refresh to push
              the credentials into the cluster.
            </span>
          </div>
          <div className={styles.subBody}>
            <ul className={styles.files}>
              {harness.subscriptionFiles.map((file) => (
                <li key={file.secretKey} className={styles.file}>
                  <span
                    className={`${styles.dot} ${file.present ? styles.dotOk : styles.dotMissing}`}
                    aria-hidden="true"
                  />
                  <code className={styles.path}>{file.hostPath}</code>
                  <span className={styles.fileState}>
                    {file.present
                      ? "found"
                      : file.required
                        ? "missing"
                        : "optional, not found"}
                  </span>
                </li>
              ))}
            </ul>
            <button
              className={styles.secondary}
              type="button"
              disabled={busy}
              onClick={onRefresh}
            >
              {busy ? "Refreshing…" : "Refresh auth files"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}

// A human description of where a harness's API key comes from, never the value.
function apiKeySourceText(harness: HarnessAuth): string {
  if (harness.apiKeySource === "override") return "Using a saved key.";
  if (harness.apiKeySource === "none")
    return `No key set${harness.apiKeyEnv ? ` (export ${harness.apiKeyEnv} or set one here)` : ""}.`;
  if (harness.apiKeySource.startsWith("dotenv:"))
    return `Discovered in ${harness.apiKeySource.slice("dotenv:".length)}.`;
  return `Discovered from ${harness.apiKeyEnv ?? "the environment"}.`;
}
