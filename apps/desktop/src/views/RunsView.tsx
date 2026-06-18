import { useEffect, useState } from "react";
import styles from "../App.module.scss";
import {
  backendConfigured,
  isTauri,
  listRuns,
  publishRun,
  readReviewItems,
  saveReview,
  type Rating,
  type ReviewItem,
  type ReviewVerdict,
  type StoredRun,
  type VerdictStatus,
} from "../api";

const RATINGS: Rating[] = ["flawless", "great", "scuffed", "broken"];
const STATUSES: { value: VerdictStatus; label: string }[] = [
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "na", label: "N/A" },
];

// A reviewer's in-progress verdict for one checklist item. An empty `status`
// means the item has not been addressed yet — the Save gate requires all of them.
type VerdictDraft = { status: VerdictStatus | ""; note: string };

// The reporter: list finished runs, write a review (writeup + rating) for one,
// and publish a reviewed run. Reviewing is required before publishing.
export function RunsView() {
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasBackend, setHasBackend] = useState(false);

  async function refresh() {
    try {
      const rs = await listRuns();
      setRuns(rs);
      if (rs[0] && !rs.some((r) => r.id === selected)) {
        setSelected(rs[0].id);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    if (!isTauri()) return;
    refresh();
    backendConfigured().then(setHasBackend).catch(() => setHasBackend(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = runs.find((r) => r.id === selected) ?? null;

  return (
    <div className={styles.view}>
      <h2 className={styles.viewTitle}>Runs & Review</h2>
      <div className={styles.actions}>
        <button className={styles.secondary} onClick={refresh}>
          Refresh
        </button>
        {!hasBackend && (
          <span className={styles.muted}>
            TCAB_BACKEND_URL is not set — publishing is disabled.
          </span>
        )}
      </div>

      {error && <p className={`${styles.notice} ${styles.error}`}>{error}</p>}

      <div className={styles.runsLayout}>
        <ul className={styles.runList}>
          {runs.length === 0 && (
            <li className={styles.muted}>No finished runs yet.</li>
          )}
          {runs.map((r) => (
            <li
              key={r.id}
              className={`${styles.runItem} ${r.id === selected ? styles.runItemActive : ""}`}
              onClick={() => setSelected(r.id)}
            >
              <div className={styles.runItemTitle}>
                {r.record.subject.testCaseSlug} / {r.record.subject.variant}
              </div>
              <div className={styles.runItemMeta}>
                {r.record.subject.harnessSlug} · {r.record.subject.modelId}
              </div>
              <div className={styles.runItemMeta}>
                {r.review ? `reviewed (${r.review.rating})` : "unreviewed"}
              </div>
            </li>
          ))}
        </ul>

        <div className={styles.runDetail}>
          {current ? (
            <RunDetail run={current} hasBackend={hasBackend} onChanged={refresh} />
          ) : (
            <p className={styles.muted}>Select a run to review or publish it.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function RunDetail({
  run,
  hasBackend,
  onChanged,
}: {
  run: StoredRun;
  hasBackend: boolean;
  onChanged: () => void;
}) {
  const [rating, setRating] = useState<Rating>(run.review?.rating ?? "great");
  const [writeup, setWriteup] = useState(run.review?.writeup ?? "");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, VerdictDraft>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset the editor when the selected run changes, then load the case's declared
  // checklist items for the run's variant. Verdicts are seeded from any saved
  // review so re-reviewing keeps prior answers.
  useEffect(() => {
    setRating(run.review?.rating ?? "great");
    setWriteup(run.review?.writeup ?? "");
    setMessage(null);
    setError(null);
    setItems([]);
    setVerdicts({});
    if (!isTauri()) return;
    let cancelled = false;
    readReviewItems(run.id)
      .then((loaded) => {
        if (cancelled) return;
        const prior = new Map(
          (run.review?.checklist ?? []).map((v) => [v.id, v]),
        );
        const drafts: Record<string, VerdictDraft> = {};
        for (const item of loaded) {
          const existing = prior.get(item.id);
          drafts[item.id] = {
            status: existing?.status ?? "",
            note: existing?.note ?? "",
          };
        }
        setItems(loaded);
        setVerdicts(drafts);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [run.id]);

  // Every declared item must carry a verdict before a review can be saved — the
  // contract that guarantees a reviewer addresses each item the case calls out.
  const allAddressed = items.every((item) => verdicts[item.id]?.status);

  function setVerdict(id: string, patch: Partial<VerdictDraft>) {
    setVerdicts((prev) => {
      const base = prev[id] ?? { status: "", note: "" };
      return {
        ...prev,
        [id]: { status: patch.status ?? base.status, note: patch.note ?? base.note },
      };
    });
  }

  function buildChecklist(): ReviewVerdict[] {
    return items.map((item) => {
      const draft = verdicts[item.id] ?? { status: "", note: "" };
      const note = draft.note.trim();
      return {
        id: item.id,
        status: draft.status as VerdictStatus,
        ...(note ? { note } : {}),
      };
    });
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await saveReview(run.id, rating, writeup, buildChecklist());
      setMessage("Review saved.");
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onPublish() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await publishRun(run.id);
      setMessage(
        `${result.newlyPublished ? "Published" : "Already published"} — source ${result.sourceRepo}` +
          (result.playableBuild ? `, build ${result.playableBuild}` : ""),
      );
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const r = run.record;
  return (
    <div>
      <h3 className={styles.detailTitle}>{r.id}</h3>
      <dl className={styles.detailGrid}>
        <dt>Case</dt>
        <dd>
          {r.subject.testCaseSlug}@{r.subject.testCaseVersion} / {r.subject.variant}
        </dd>
        <dt>Harness</dt>
        <dd>
          {r.subject.harnessSlug}
          {r.subject.harnessVersion ? ` ${r.subject.harnessVersion}` : ""}
        </dd>
        <dt>Model</dt>
        <dd>{r.subject.modelId}</dd>
        <dt>State</dt>
        <dd>{r.status.state}</dd>
        <dt>Loaded</dt>
        <dd>{String(r.validation.loaded)}</dd>
        <dt>Cost</dt>
        <dd>${r.metrics.cost.comparable.toFixed(4)} comparable</dd>
      </dl>

      <p className={styles.sectionLabel}>Review</p>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Rating</span>
        <select
          className={styles.select}
          value={rating}
          onChange={(e) => setRating(e.target.value as Rating)}
        >
          {RATINGS.map((rt) => (
            <option key={rt} value={rt}>
              {rt}
            </option>
          ))}
        </select>
      </label>

      {items.length > 0 && (
        <div className={styles.checklist}>
          <p className={styles.sectionLabel}>
            Checklist — every item must be addressed
          </p>
          {items.map((item) => {
            const draft = verdicts[item.id] ?? { status: "", note: "" };
            return (
              <div key={item.id} className={styles.checklistItem}>
                <span className={styles.checklistText}>{item.text}</span>
                <div className={styles.checklistControls}>
                  <select
                    className={styles.select}
                    value={draft.status}
                    onChange={(e) =>
                      setVerdict(item.id, {
                        status: e.target.value as VerdictStatus | "",
                      })
                    }
                  >
                    <option value="">— pick —</option>
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={styles.input}
                    value={draft.note}
                    onChange={(e) => setVerdict(item.id, { note: e.target.value })}
                    placeholder="note (optional)"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <textarea
        className={styles.textarea}
        rows={8}
        value={writeup}
        onChange={(e) => setWriteup(e.target.value)}
        placeholder="Writeup: how did the build play? What worked, what was broken?"
      />

      <div className={styles.actions}>
        <button
          className={styles.primary}
          onClick={onSave}
          disabled={busy || !writeup.trim() || !allAddressed}
          title={
            !allAddressed
              ? "Give every checklist item a verdict before saving"
              : undefined
          }
        >
          Save review
        </button>
        <button
          className={styles.secondary}
          onClick={onPublish}
          disabled={busy || !run.review || !hasBackend}
          title={
            !run.review
              ? "Write and save a review first"
              : !hasBackend
                ? "Set TCAB_BACKEND_URL to publish"
                : undefined
          }
        >
          Publish run
        </button>
      </div>

      {message && <p className={`${styles.notice} ${styles.ok}`}>{message}</p>}
      {error && <p className={`${styles.notice} ${styles.error}`}>{error}</p>}
    </div>
  );
}
