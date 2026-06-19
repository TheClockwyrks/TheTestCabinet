import { useEffect, useState } from "react";
import { Panel } from "@test-cabinet/ui";
import { useBackend, useWorkers } from "../../../../client/context";
import type {
  ReviewItem,
  ReviewVerdict,
  VerdictStatus,
} from "../../../../client/types";
import type { RunSubject } from "@test-cabinet/run-record";
import {
  RATINGS,
  RATING_META,
  VERDICT_META,
  isRating,
  type ParsedWriteup,
  type Rating,
} from "../../../data/ratings";
import styles from "../RunExec.module.scss";

interface VerdictDraft {
  status: VerdictStatus | "";
  note: string;
}

const STATUSES: VerdictStatus[] = ["pass", "fail", "na"];

// The rating criteria, surfaced in a hover tooltip beside the Rating label so a
// reviewer is reminded what each tier means without leaving the form. Built from
// the shared RATING_META so it stays in lockstep with the tiers themselves.
const RATING_CRITERIA = RATINGS.map(
  (rt) => `${RATING_META[rt].label} — ${RATING_META[rt].description}`,
).join("\n\n");

// The editable Verdict mode for a produced, not-yet-published run that the active
// worker owns: rate it, work the case's declared checklist, write the review, and
// publish (the review is submitted with the publish). Read-only published runs
// keep the plain verdict rendering; this is shown only when the run is
// worker-owned and unpublished. Ported from the old console Review screen's run
// detail.
export function RunReviewEditor({
  runId,
  subject,
  review,
  onChanged,
}: {
  runId: string;
  subject: RunSubject;
  review: ParsedWriteup | undefined;
  onChanged: () => void;
}) {
  const { active: worker } = useWorkers();
  const client = worker?.client ?? null;
  // The checklist items are catalog data: read them from the backend, keyed by
  // the run's case identity — the worker doesn't serve the catalog.
  const { client: backend } = useBackend();
  const [rating, setRating] = useState<Rating>(review?.rating ?? "great");
  const [writeup, setWriteup] = useState(review?.body ?? "");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, VerdictDraft>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the case's declared checklist items from the backend (common + this
  // variant's own), seeding verdicts from any prior review so re-reviewing keeps
  // earlier answers.
  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    const prior = new Map((review?.checklist ?? []).map((v) => [v.id, v]));
    backend
      .readReviewItems(
        subject.testCaseSlug,
        subject.testCaseVersion,
        subject.variant,
      )
      .then((loaded) => {
        if (cancelled) return;
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
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // Seed only on run/backend change; `review` is the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    backend,
    subject.testCaseSlug,
    subject.testCaseVersion,
    subject.variant,
  ]);

  const allAddressed = items.every((item) => verdicts[item.id]?.status);

  function setVerdict(id: string, patch: Partial<VerdictDraft>) {
    setVerdicts((prev) => {
      const base = prev[id] ?? { status: "", note: "" };
      return {
        ...prev,
        [id]: {
          status: patch.status ?? base.status,
          note: patch.note ?? base.note,
        },
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

  async function onPublish() {
    if (!client) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await client.publish(runId, {
        rating,
        writeup,
        checklist: buildChecklist(),
      });
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

  if (!client) {
    return (
      <Panel>
        <p className={`${styles.notice} ${styles.warn}`}>
          No worker connected — connect the worker that produced this run (the
          gear in the top bar) to review and publish it.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      {items.length > 0 && (
        <div className={styles.checklist}>
          <p className={styles.sectionLabel}>
            Checklist — every item must be addressed
          </p>
          {items.map((item, index) => {
            const draft = verdicts[item.id] ?? { status: "", note: "" };
            return (
              <div key={item.id} className={styles.checklistItem}>
                <span className={styles.checklistTitle}>
                  <span className={styles.checklistNumber}>{index + 1}.</span>{" "}
                  {item.title}
                </span>
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
                      <option key={s} value={s}>
                        {VERDICT_META[s].label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={styles.input}
                    value={draft.note}
                    onChange={(e) =>
                      setVerdict(item.id, { note: e.target.value })
                    }
                    placeholder="note (optional)"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Writeup</span>
        <textarea
          className={styles.textarea}
          rows={8}
          value={writeup}
          onChange={(e) => setWriteup(e.target.value)}
          placeholder="How did the build play? What worked, what was broken?"
        />
      </label>

      <label className={`${styles.field} ${styles.fieldStacked}`}>
        <span className={styles.fieldLabel}>
          Rating
          <span
            className={styles.help}
            role="img"
            aria-label="Rating criteria"
            title={RATING_CRITERIA}
          >
            ?
          </span>
        </span>
        <select
          className={styles.select}
          value={rating}
          onChange={(e) => isRating(e.target.value) && setRating(e.target.value)}
        >
          {RATINGS.map((rt) => (
            <option key={rt} value={rt}>
              {rt}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.actions}>
        <button
          className={styles.primary}
          onClick={onPublish}
          disabled={busy || !writeup.trim() || !allAddressed}
          title={
            !writeup.trim() || !allAddressed
              ? "Write a review and give every checklist item a verdict before publishing"
              : undefined
          }
        >
          Publish run
        </button>
      </div>

      {message && <p className={`${styles.notice} ${styles.ok}`}>{message}</p>}
      {error && <p className={`${styles.notice} ${styles.error}`}>{error}</p>}
    </Panel>
  );
}
