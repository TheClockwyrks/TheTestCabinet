import { useCallback, useEffect, useState } from "react";
import { Panel } from "@clockwyrks/ui";
import { LoadingState } from "../../components/LoadingState";
import { useRevealNotice } from "../../components/SubmitNotice";
import { SettingsLayout } from "../../layouts/settings/SettingsLayout";
import {
  useHarnessConfig,
  type HarnessConfigApi,
} from "../../data/useHarnessConfig";
import type { HarnessConfigEntry } from "../../../client/types";
import styles from "./HarnessesPage.module.scss";

// The Harnesses settings tab (`/settings/harnesses`): per-harness **parallelism** —
// how many runs of a harness the Test Cabinet drives at once. It is backend-backed
// (the backend's claim enforces it by holding surplus runs `pending`). Harness
// credentials are not set here: the operator provisions them in the deployment.
//
// Each harness gets one card carrying its settings.
export function HarnessesPage() {
  const config = useHarnessConfig();
  if (!config) {
    // Reached only if the route mounted without the capability (e.g. a read-only
    // host, or a transport without the endpoint); keep the page honest rather than
    // blank.
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
  return <HarnessesBody config={config} />;
}

function HarnessesBody({ config }: { config: HarnessConfigApi }) {
  const [configs, setConfigs] = useState<HarnessConfigEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRevealNotice<HTMLParagraphElement>(error);
  // The slug of the harness whose request is in flight, to disable its controls.
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    config
      .list()
      .then((list) => active && setConfigs(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [config]);

  // Save one harness's limit, adopt the refreshed list, and gate the card while
  // the request is in flight. Errors surface inline.
  const saveLimit = useCallback(
    async (slug: string, value: number | null) => {
      const set = config.setMaxParallelism;
      if (!set) return;
      setBusy(slug);
      setError(null);
      try {
        setConfigs(await set(slug, value));
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [config],
  );

  const canEditLimit = config.setMaxParallelism != null;

  return (
    <SettingsLayout tab="harnesses">
      <Panel className={styles.intro}>
        <p className={styles.muted}>
          Tune how each harness runs. <strong>Max parallelism</strong> caps how
          many runs of a harness the Test Cabinet drives at once. Extra runs
          wait as <em>pending</em> until a slot frees.
        </p>
      </Panel>

      {!canEditLimit && (
        <Panel className={styles.intro}>
          <p className={styles.muted}>
            Sign in to change a harness&rsquo;s maximum parallelism.
          </p>
        </Panel>
      )}

      {error && (
        <Panel className={styles.errorPanel}>
          <p ref={errorRef} className={styles.error} role="alert">
            {error}
          </p>
        </Panel>
      )}

      {configs === null && !error && (
        <Panel>
          <LoadingState size="section" label="Loading harnesses…" />
        </Panel>
      )}

      {configs?.map((entry) => (
        <Panel key={entry.slug} className={styles.card}>
          <header>
            <h2 className={styles.title}>{entry.name}</h2>
            <p className={styles.slug}>{entry.slug}</p>
          </header>
          <ParallelismRow
            entry={entry}
            busy={busy === entry.slug}
            canEdit={canEditLimit}
            onSave={(value) => void saveLimit(entry.slug, value)}
          />
        </Panel>
      ))}
    </SettingsLayout>
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
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 1);
  const changed = (current == null ? "" : String(current)) !== trimmed;

  return (
    <section className={styles.row}>
      <div className={styles.label}>
        <span className={styles.rowTitle}>Max parallelism</span>
        <span className={styles.hint}>
          {current == null
            ? "No limit: runs of this harness are dispatched as capacity allows."
            : `At most ${current} run${current === 1 ? "" : "s"} of this harness at once.`}
        </span>
      </div>
      {canEdit ? (
        <form
          className={styles.limitForm}
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
