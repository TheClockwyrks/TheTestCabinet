import { useCallback, useEffect, useState } from "react";
import { Panel, SegmentedControl } from "@test-cabinet/ui";
import { SettingsLayout } from "../../layouts/settings/SettingsLayout";
import {
  useGalleryData,
  type HarnessAuth,
  type HarnessAuthApi,
  type HarnessAuthMode,
} from "../../data/galleryContext";
import styles from "./HarnessAuthPage.module.scss";

// The Authentication tab (`/settings/authentication`), present only in the desktop
// app — the host that stands up a local cluster and so must give each run's
// harness credentials. It is gated on the `harnessAuth` capability (absent in the
// web console and the static site). It manages, per harness: the authentication
// method (auto / subscription / API key), a per-harness API key, and the
// subscription credential files, refreshing them from the host's signed-in CLIs.
// Every change is persisted by the shell and applied to the running cluster.
export function HarnessAuthPage() {
  const { harnessAuth } = useGalleryData();
  if (!harnessAuth) {
    // The route only mounts where the capability exists; this keeps the page
    // honest if it is ever reached without one.
    return (
      <SettingsLayout tab="authentication">
        <Panel>
          <p className={styles.muted}>
            Harness authentication is managed only in the desktop app.
          </p>
        </Panel>
      </SettingsLayout>
    );
  }
  return <HarnessAuthBody api={harnessAuth} />;
}

function HarnessAuthBody({ api }: { api: HarnessAuthApi }) {
  const [harnesses, setHarnesses] = useState<HarnessAuth[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The slug of the harness whose request is in flight, to disable its controls.
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .list()
      .then((list) => active && setHarnesses(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [api]);

  // Run one mutation and adopt its refreshed list, so the view always reflects
  // what the shell applied. Errors surface inline; the busy slug gates its card.
  const run = useCallback(
    async (slug: string, op: () => Promise<HarnessAuth[]>) => {
      setBusy(slug);
      setError(null);
      try {
        setHarnesses(await op());
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  return (
    <SettingsLayout tab="authentication">
      <Panel className={styles.intro}>
        <p className={styles.muted}>
          Choose how each harness authenticates the runs you launch on the local
          cluster. Keys are stored on this machine and applied to the cluster; in{" "}
          <strong>Auto</strong> a harness prefers a subscription when you are
          signed in, otherwise its API key.
        </p>
      </Panel>

      {error && (
        <Panel className={styles.errorPanel}>
          <p className={styles.error}>{error}</p>
        </Panel>
      )}

      {harnesses === null && !error && (
        <Panel>
          <p className={styles.muted}>Loading harnesses…</p>
        </Panel>
      )}

      {harnesses?.map((harness) => (
        <HarnessCard
          key={harness.slug}
          harness={harness}
          busy={busy === harness.slug}
          onSetMode={(mode) =>
            run(harness.slug, () => api.setAuthMode(harness.slug, mode))
          }
          onSetKey={(key) =>
            run(harness.slug, () => api.setApiKey(harness.slug, key))
          }
          onRefresh={() =>
            run(harness.slug, () => api.refreshSubscription(harness.slug))
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

  const readiness = READINESS[harness.readiness] ?? {
    label: harness.readiness,
    tone: styles.toneMuted,
  };
  const badgeTone = readiness.tone ?? "";

  return (
    <Panel className={styles.card}>
      <header className={styles.cardHead}>
        <div>
          <h2 className={styles.title}>{harness.name}</h2>
          <p className={styles.slug}>{harness.slug}</p>
        </div>
        <span className={`${styles.badge} ${badgeTone}`}>{readiness.label}</span>
      </header>

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
    </Panel>
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
