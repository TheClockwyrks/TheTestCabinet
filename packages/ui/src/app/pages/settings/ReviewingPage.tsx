import { useCallback, useEffect, useState } from "react";
import { Panel } from "@test-cabinet/ui";
import type { CoverageSettings } from "@test-cabinet/run-record/coverage";
import { LoadingState } from "../../components/LoadingState";
import { SettingsLayout } from "../../layouts/settings/SettingsLayout";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import styles from "./ReviewingPage.module.scss";

// The Reviewing settings tab (`/settings/reviewing`, web/desktop only): the
// account-wide preferences that govern how much reviewing work the cabinet puts in
// front of you. Today that is the review buffer — how many runs the reviewer is
// willing to have outstanding (in flight, or finished and waiting on their review)
// before every plan and ladder of theirs stops enqueueing more.
//
// It is a property of the *reviewer* rather than of any one plan, which is why it
// sits in Settings rather than on the Coverage tab; a plan or ladder that wants a
// different depth overrides it in its own editor. `0` is a legitimate value meaning
// "never top me up automatically".
export function ReviewingPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();

  const [settings, setSettings] = useState<CoverageSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!backend?.getCoverageSettings || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    backend
      .getCoverageSettings(token)
      .then((s) => {
        if (!active) return;
        setSettings(s);
        setLoading(false);
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

  const saveBuffer = useCallback(
    async (bufferTarget: number) => {
      if (!backend?.setCoverageSettings || !token) return;
      setBusy(true);
      setError(null);
      try {
        setSettings(await backend.setCoverageSettings({ bufferTarget }, token));
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token],
  );

  if (!token) {
    return (
      <SettingsLayout tab="reviewing">
        <Panel>
          <p className={styles.muted}>
            Sign in to change your reviewing settings — they are saved to your
            account. Use the account control in the top bar to register or log
            in.
          </p>
        </Panel>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout tab="reviewing">
      {error && (
        <Panel className={styles.errorPanel}>
          <p className={styles.error}>{error}</p>
        </Panel>
      )}

      <Panel className={styles.panel}>
        {loading ? (
          <LoadingState size="section" label="Loading settings…" />
        ) : settings ? (
          <BufferSetting
            settings={settings}
            busy={busy}
            onSave={(target) => void saveBuffer(target)}
          />
        ) : (
          <p className={styles.muted}>
            Reviewing settings aren&rsquo;t available on this host.
          </p>
        )}
      </Panel>
    </SettingsLayout>
  );
}

// The review-buffer control: a number field with Save, disabled until the draft is
// both valid and different from what is saved.
function BufferSetting({
  settings,
  busy,
  onSave,
}: {
  settings: CoverageSettings;
  busy: boolean;
  onSave: (bufferTarget: number) => void;
}) {
  const [draft, setDraft] = useState(String(settings.bufferTarget));
  // Re-sync when the saved value changes underneath (a save returns the stored
  // settings, which may have been clamped).
  useEffect(() => {
    setDraft(String(settings.bufferTarget));
  }, [settings.bufferTarget]);

  const parsed = Math.floor(Number(draft));
  const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
  const dirty = valid && parsed !== settings.bufferTarget;

  return (
    <section className={styles.setting}>
      <div className={styles.label}>
        <h2 className={styles.title}>Review buffer</h2>
        <p className={styles.description}>
          Runs your plans may leave outstanding before a top-up stops.
        </p>
      </div>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || !dirty) return;
          onSave(Math.min(parsed, 500));
        }}
      >
        <input
          className={styles.input}
          type="number"
          min={0}
          max={500}
          step={1}
          inputMode="numeric"
          aria-label="Review buffer"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className={styles.primary}
          type="submit"
          disabled={busy || !dirty}
        >
          {dirty ? "Save buffer" : "Saved"}
        </button>
      </form>
    </section>
  );
}
