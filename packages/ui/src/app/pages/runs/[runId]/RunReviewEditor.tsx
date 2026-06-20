import { useEffect, useMemo, useState } from "react";
import { Panel } from "@test-cabinet/ui";
import { useBackend, useWorkers } from "../../../../client/context";
import type {
  ProofMedia,
  ReferenceShot,
  ReviewItem,
  ReviewVerdict,
  VerdictStatus,
} from "../../../../client/types";
import type { RunSubject } from "@test-cabinet/run-record";
import { useGalleryData } from "../../../data/galleryContext";
import { MediaView } from "../../../components/MediaView";
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

const STATUSES: VerdictStatus[] = ["pass", "fail"];

// The rating criteria, surfaced in a hover tooltip beside each domain's Rating
// label so a reviewer is reminded what each tier means without leaving the form.
// Built from the shared RATING_META so it stays in lockstep with the tiers.
const RATING_CRITERIA = RATINGS.map(
  (rt) => `${RATING_META[rt].label} — ${RATING_META[rt].description}`,
).join("\n\n");

/** Format a point weight as `1 pt` / `2 pts`. */
function pts(weight: number): string {
  return `${weight} ${weight === 1 ? "pt" : "pts"}`;
}

// The editable Verdict mode for a produced, not-yet-published run that the active
// worker owns: rate it, work the case's declared checklist one item at a time,
// write the review, and publish (the review is submitted with the publish).
//
// The checklist is presented one question at a time with a navigable rail of all
// items (answered ones marked done) so the reviewer can move freely. Each question
// shows the case's expected reference beside the agent's submitted proof — when
// the item declares them — so the reviewer compares the target against the
// evidence before judging. Read-only published runs keep the plain verdict
// rendering; this is shown only when the run is worker-owned and unpublished.
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
  const gallery = useGalleryData();
  // The case's scoring domains, rated independently; the run's overall rating is
  // the worst across them. Resolved from the catalog the host holds.
  const domains = useMemo(
    () => gallery.reviewModelFor(subject).domains,
    [gallery, subject],
  );
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [writeup, setWriteup] = useState(review?.body ?? "");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, VerdictDraft>>({});
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The expected reference media (by view) and the submitted proof media (by id)
  // for this run, resolved from the gallery data so each question can show both.
  const referencesByView = useMemo(() => {
    const tc = gallery.testCases.find((c) => c.slug === subject.testCaseSlug);
    const variant = tc?.variants.find((v) => v.slug === subject.variant);
    const map = new Map<string, ReferenceShot>();
    for (const ref of variant?.referenceScreenshots ?? []) {
      map.set(ref.view, { view: ref.view, kind: ref.kind, url: ref.url });
    }
    return map;
  }, [gallery.testCases, subject.testCaseSlug, subject.variant]);

  const proofsById = useMemo(() => {
    const run = gallery.runs.find((r) => r.id === runId);
    const map = new Map<string, ProofMedia>();
    if (run) {
      for (const proof of gallery.proofMediaFor(run)) map.set(proof.id, proof);
    }
    return map;
  }, [gallery, runId]);

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
        setCurrent(0);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // Seed only on run/backend change; `review` is the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, subject.testCaseSlug, subject.testCaseVersion, subject.variant]);

  // Seed each domain's rating from any prior review, defaulting to "great" so a
  // domain always carries a value (the reviewer adjusts it down where warranted).
  useEffect(() => {
    const prior = new Map((review?.ratings ?? []).map((r) => [r.domain, r.rating]));
    const seeded: Record<string, Rating> = {};
    for (const domain of domains) seeded[domain.id] = prior.get(domain.id) ?? "great";
    setRatings(seeded);
    // Seed only when the domain set changes; `review` is the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains]);

  const allAddressed = items.every((item) => verdicts[item.id]?.status);
  const allRated = domains.every((domain) => ratings[domain.id]);
  const answeredCount = items.filter((i) => verdicts[i.id]?.status).length;

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
        ratings: domains.map((domain) => ({
          domain: domain.id,
          rating: ratings[domain.id] ?? "great",
        })),
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

  const item = items[current];
  const draft = item ? (verdicts[item.id] ?? { status: "", note: "" }) : null;
  const expected = item?.reference
    ? referencesByView.get(item.reference)
    : undefined;
  const submitted = item?.proof ? proofsById.get(item.proof) : undefined;

  return (
    <Panel>
      {item && draft && (
        <div className={styles.reviewLayout}>
          {/* The navigable rail of every checklist item; answered items are
              marked done, the current one highlighted. */}
          <nav className={styles.itemRail} aria-label="Checklist items">
            <p className={styles.sectionLabel}>
              {answeredCount}/{items.length} addressed
            </p>
            <ol className={styles.itemNavList}>
              {items.map((it, index) => {
                const answered = Boolean(verdicts[it.id]?.status);
                const isCurrent = index === current;
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      className={`${styles.itemNav}${
                        isCurrent ? ` ${styles.itemNavActive}` : ""
                      }${answered ? ` ${styles.itemNavDone}` : ""}`}
                      onClick={() => setCurrent(index)}
                      aria-current={isCurrent ? "true" : undefined}
                    >
                      <span className={styles.itemNavMark} aria-hidden="true">
                        {answered ? "✓" : index + 1}
                      </span>
                      <span className={styles.itemNavTitle}>
                        {it.title} ({pts(it.weight)})
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {/* The current question: title, description, the expected vs submitted
              media (when the item pairs them), and the verdict controls. */}
          <div className={styles.questionPanel}>
            <span className={styles.checklistTitle}>
              <span className={styles.checklistNumber}>{current + 1}.</span>{" "}
              {item.title} ({pts(item.weight)})
            </span>
            <span className={styles.checklistText}>{item.text}</span>

            {/* Expected reference beside submitted proof. Each pane shows only
                when that side exists — an item may declare just a proof (e.g. a
                video clip with no still that depicts it), so it takes the full
                width rather than reserving an empty Expected column. */}
            {(expected || item.proof) && (
              <div
                className={`${styles.mediaPanes}${
                  expected && item.proof ? "" : ` ${styles.mediaPanesSingle}`
                }`}
              >
                {expected && (
                  <figure className={styles.mediaPane}>
                    <figcaption className={styles.mediaPaneLabel}>
                      Expected
                    </figcaption>
                    <MediaView
                      kind={expected.kind}
                      url={expected.url}
                      alt={`Expected ${item.reference}`}
                    />
                  </figure>
                )}
                {item.proof && (
                  <figure className={styles.mediaPane}>
                    <figcaption className={styles.mediaPaneLabel}>
                      Submitted
                    </figcaption>
                    {submitted && submitted.present && submitted.url ? (
                      <MediaView
                        kind={submitted.kind}
                        url={submitted.url}
                        alt={`Submitted ${item.proof}`}
                      />
                    ) : (
                      <p className={styles.mediaMissing}>
                        {submitted && !submitted.present
                          ? "The agent did not submit this proof."
                          : "Proof media is not available here."}
                      </p>
                    )}
                  </figure>
                )}
              </div>
            )}

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
                onChange={(e) => setVerdict(item.id, { note: e.target.value })}
                placeholder="note (optional)"
              />
            </div>

            <div className={styles.questionNav}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                disabled={current === 0}
              >
                ← Previous
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() =>
                  setCurrent((c) => Math.min(items.length - 1, c + 1))
                }
                disabled={current >= items.length - 1}
              >
                Next →
              </button>
            </div>
          </div>
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

      {/* One rating per scoring domain — the reviewer rates each independently and
          the run's overall rating is the worst across them. */}
      <fieldset className={styles.ratings}>
        <legend className={styles.fieldLabel}>
          Ratings
          <span
            className={styles.help}
            role="img"
            aria-label="Rating criteria"
            title={RATING_CRITERIA}
          >
            ?
          </span>
        </legend>
        {domains.map((domain) => (
          <label
            key={domain.id}
            className={`${styles.field} ${styles.fieldStacked}`}
          >
            <span className={styles.fieldLabel} title={domain.description}>
              {domain.name}
            </span>
            <select
              className={styles.select}
              value={ratings[domain.id] ?? "great"}
              onChange={(e) =>
                isRating(e.target.value) &&
                setRatings((prev) => ({
                  ...prev,
                  [domain.id]: e.target.value as Rating,
                }))
              }
            >
              {RATINGS.map((rt) => (
                <option key={rt} value={rt}>
                  {rt}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>

      <div className={styles.actions}>
        <button
          className={styles.primary}
          onClick={onPublish}
          disabled={busy || !writeup.trim() || !allAddressed || !allRated}
          title={
            !writeup.trim() || !allAddressed || !allRated
              ? "Write a review, rate every domain, and give every checklist item a verdict before publishing"
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
