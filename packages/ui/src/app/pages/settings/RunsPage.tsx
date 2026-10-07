import { useCallback, useEffect, useState } from "react";
import { Panel } from "@clockwyrks/ui";
import type {
  CoverageSettings,
  InFlightLimit,
} from "@clockwyrks/run-record/coverage";
import { Switch } from "../../components/Switch";
import {
  IN_FLIGHT_LIMIT_CEILING,
  UNBOUNDED_LIMIT,
  boundedLimit,
  limitBound,
  sameInFlightLimit,
} from "../account/inFlightLimit";
import { LoadingState } from "../../components/LoadingState";
import { useRevealNotice } from "../../components/SubmitNotice";
import { SettingsLayout } from "../../layouts/settings/SettingsLayout";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { Button, Input } from "../../../primitives";
import styles from "./RunsPage.module.scss";

// The Runs settings tab (`/settings/runs`, web console only): the account-wide
// runs-in-flight limit — how many of one plan's or one ladder's runs may be queued or
// running at once. It keeps any one plan or ladder from taking over the shared queue;
// completed runs never count against it, reviewed or not, because reviews never pace
// execution.
//
// It is a property of the account rather than of any one plan, which is why it sits
// in Settings; a plan or ladder that needs a different limit overrides it in its own
// editor. `0` is a legitimate value meaning "launch nothing", and "No limit" is a
// third instruction of its own: every plan and ladder launches everything it can at
// once unless it says otherwise.
export function RunsPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();

  const [settings, setSettings] = useState<CoverageSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRevealNotice<HTMLParagraphElement>(error);

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

  const saveLimit = useCallback(
    async (inFlightLimit: InFlightLimit) => {
      if (!backend?.setCoverageSettings || !token) return;
      setBusy(true);
      setError(null);
      try {
        setSettings(
          await backend.setCoverageSettings({ inFlightLimit }, token),
        );
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
      <SettingsLayout tab="runs">
        <Panel>
          <p className={styles.muted}>
            Sign in to change your run settings. They are saved to your account.
            Use the account control in the top bar to register or log in.
          </p>
        </Panel>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout tab="runs">
      {error && (
        <Panel className={styles.errorPanel}>
          <p ref={errorRef} className={styles.error} role="alert">
            {error}
          </p>
        </Panel>
      )}

      <Panel className={styles.panel}>
        {loading ? (
          <LoadingState size="section" label="Loading settings…" />
        ) : settings ? (
          <InFlightSetting
            settings={settings}
            busy={busy}
            onSave={(limit) => void saveLimit(limit)}
          />
        ) : (
          <p className={styles.muted}>
            Run settings aren&rsquo;t available on this host.
          </p>
        )}
      </Panel>
    </SettingsLayout>
  );
}

// The runs-in-flight control: a number field and a no-limit switch with Save,
// disabled until the draft is both valid and different from what is saved.
function InFlightSetting({
  settings,
  busy,
  onSave,
}: {
  settings: CoverageSettings;
  busy: boolean;
  onSave: (inFlightLimit: InFlightLimit) => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(settings.inFlightLimit));
  // Re-sync when the saved value changes underneath (a save returns the stored
  // settings, which may have been clamped).
  useEffect(() => {
    setDraft(draftOf(settings.inFlightLimit));
  }, [settings.inFlightLimit]);

  const parsed = Math.floor(Number(draft.runs));
  const valid =
    draft.unbounded ||
    (draft.runs.trim() !== "" && Number.isFinite(parsed) && parsed >= 0);
  const target: InFlightLimit | null = !valid
    ? null
    : draft.unbounded
      ? UNBOUNDED_LIMIT
      : boundedLimit(parsed);
  const dirty =
    target !== null && !sameInFlightLimit(target, settings.inFlightLimit);

  return (
    <section className={styles.setting}>
      <div className={styles.label}>
        <h2 className={styles.title}>Runs in flight</h2>
        <p className={styles.description}>
          How many of one plan&rsquo;s or one ladder&rsquo;s runs may be queued
          or running at once. Keeps one plan or ladder from taking over the
          queue; each launches more as its runs finish. Completed runs never
          count. A plan or ladder can override this in its editor.
        </p>
      </div>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || !dirty || target === null) return;
          onSave(target);
        }}
      >
        <Input
          className={styles.input}
          type="number"
          min={0}
          max={IN_FLIGHT_LIMIT_CEILING}
          step={1}
          inputMode="numeric"
          aria-label="Runs in flight"
          value={draft.runs}
          disabled={busy || draft.unbounded}
          onChange={(e) => setDraft({ ...draft, runs: e.target.value })}
        />
        <label className={styles.toggle}>
          <Switch
            checked={draft.unbounded}
            disabled={busy}
            ariaLabel="No limit"
            onChange={(unbounded) => setDraft({ ...draft, unbounded })}
          />
          <span>No limit</span>
        </label>
        <Button variant="primary" type="submit" disabled={busy || !dirty}>
          {dirty || !valid ? "Save limit" : "Saved"}
        </Button>
      </form>
    </section>
  );
}

/** The form's two fields, as the saved limit fills them in. A saved bound stays in
 *  the number while no-limit is switched on, so switching it back off restores it;
 *  a saved no-limit has no bound to show, so switching it off leaves the number to
 *  be typed. */
function draftOf(limit: InFlightLimit): { runs: string; unbounded: boolean } {
  const bound = limitBound(limit);
  return {
    runs: bound === null ? "" : String(bound),
    unbounded: bound === null,
  };
}
