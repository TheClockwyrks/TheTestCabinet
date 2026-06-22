import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Panel, RatingBadge } from "@test-cabinet/ui";
import { routes } from "../../../routes";
import { useBackend, useWorkers } from "../../../../client/context";
import { useAuth } from "../../../../client/auth";
import type {
  ProofMedia,
  ReferenceShot,
  ReviewItem,
  ReviewVerdict,
  StoredReview,
  VerdictStatus,
} from "../../../../client/types";
import type { RunSubject } from "@test-cabinet/run-record";
import { useGalleryData } from "../../../data/galleryContext";
import { MediaView } from "../../../components/MediaView";
import { ReviewItemAssets } from "./AssetResultSection";
import {
  RATINGS,
  RATING_META,
  VERDICT_META,
  aggregateRating,
  aggregateScore,
  isRating,
  scoreChecklist,
  worstRating,
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

// The editable Verdict mode for a produced run the active worker owns: rate it,
// work the case's declared checklist one item at a time, write the review, and
// drive it through the push -> review -> publish lifecycle. Pushing a run (its
// source + build released and the record stored privately) needs *no* review — it
// is what makes the run reviewable — and a run can be published only once it
// carries at least one review. On the web flow these are three distinct actions
// (Push / Submit review / Publish). The desktop's local core folds review +
// publish into one *solo* command, so there the editor offers a standalone "Push
// run" (so a run can be pushed without being reviewed) alongside a single
// "Publish run" that saves the review and pushes + publishes in one step.
//
// Every mutating action requires a signed-in account; signing in and viewing the
// account live on their own pages (reached from the top bar's account control),
// so the editor only links to the sign-in page when signed out. A review is
// attributed to the signed-in account, and a run may carry one review per
// account. The editor seeds from the *current account's own* prior review (when
// any) so re-reviewing keeps that reviewer's answers.
//
// The checklist is presented one question at a time with a navigable rail of all
// items (answered ones marked done) so the reviewer can move freely. Each question
// shows the case's expected reference beside the agent's submitted proof — when
// the item declares them — so the reviewer compares the target against the
// evidence before judging. The run's existing reviews and the aggregate
// rating/score are shown above the form.
export function RunReviewEditor({
  runId,
  subject,
  onChanged,
}: {
  runId: string;
  subject: RunSubject;
  onChanged: () => void;
}) {
  const { active: worker } = useWorkers();
  const client = worker?.client ?? null;
  // The desktop's local worker collapses push/review/publish into one solo
  // command, so the editor offers a single Publish action there.
  const solo = worker?.local ?? false;
  const { account, token } = useAuth();
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
  // Every review submitted against this run so far, and the current account's own
  // prior review (when any) — the seed for re-reviewing.
  const reviews = useMemo(() => gallery.reviewsFor(runId), [gallery, runId]);
  const ownReview = useMemo(
    () => reviews.find((r) => account && r.reviewerId === account.id),
    [reviews, account],
  );
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [writeup, setWriteup] = useState(ownReview?.writeup ?? "");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, VerdictDraft>>({});
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether the run has been pushed this session (the worker stores it privately
  // once pushed). Seeded true when it already carries reviews — those imply it
  // was pushed. Used by both flows' Push button to disable a redundant re-push.
  const [pushed, setPushed] = useState(reviews.length > 0);
  // Reviews this account has submitted this session, so Publish enables without a
  // refetch right after submitting.
  const [submittedThisSession, setSubmittedThisSession] = useState(false);

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

  // For an asset-generation run, its resolved result (frames + sprite sheet) so a
  // checklist item that names sequences/frames can show exactly those assets
  // beside the question — no scrolling up to the generated-asset section. Null for
  // a non-asset run.
  const asset = useMemo(() => {
    const run = gallery.runs.find((r) => r.id === runId);
    return run ? gallery.assetResultFor(run) : null;
  }, [gallery, runId]);

  // Load the case's declared checklist items from the backend (common + this
  // variant's own), seeding verdicts from the account's own prior review so
  // re-reviewing keeps that reviewer's earlier answers.
  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    const prior = new Map((ownReview?.checklist ?? []).map((v) => [v.id, v]));
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
    // Seed on run/backend/account change; `ownReview` is the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    backend,
    subject.testCaseSlug,
    subject.testCaseVersion,
    subject.variant,
    account?.id,
  ]);

  // Seed each domain's rating from the account's own prior review, defaulting to
  // "great" so a domain always carries a value (adjusted down where warranted).
  useEffect(() => {
    const prior = new Map(
      (ownReview?.ratings ?? []).map((r) => [r.domain, r.rating]),
    );
    const seeded: Record<string, Rating> = {};
    for (const domain of domains)
      seeded[domain.id] = prior.get(domain.id) ?? "great";
    setRatings(seeded);
    // Seed when the domain set or account changes; `ownReview` is the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains, account?.id]);

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

  // The reviewer's input as the worker contract carries it.
  function buildReview() {
    return {
      ratings: domains.map((domain) => ({
        domain: domain.id,
        rating: ratings[domain.id] ?? "great",
      })),
      writeup,
      checklist: buildChecklist(),
    };
  }

  // Run a mutating lifecycle action, wrapping it in the busy/error/message
  // plumbing so each button shares one path.
  async function run(label: string, action: () => Promise<void>) {
    if (!client || !token) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(label);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // --- Lifecycle actions ---

  // Push: release the run's source + build and store it privately (web flow).
  const onPush = () =>
    run("Pushed — source and build released.", async () => {
      const result = await client!.push(runId, token!);
      setPushed(true);
      setMessage(
        `${result.newlyPushed ? "Pushed" : "Already pushed"}` +
          (result.sourceRepo ? ` — source ${result.sourceRepo}` : "") +
          (result.playableBuild ? `, build ${result.playableBuild}` : ""),
      );
    });

  // Submit review: attribute this account's review to the run (web flow). On the
  // solo desktop path this saves the local draft.
  const onSubmitReview = () =>
    run("Review submitted.", async () => {
      await client!.submitReview(runId, buildReview(), token!);
      setSubmittedThisSession(true);
    });

  // Publish: clear the gate (web flow). On the solo desktop path this saves the
  // review and runs push + review + publish in one step.
  const onPublish = () =>
    run("Published.", async () => {
      if (solo) {
        await client!.submitReview(runId, buildReview(), token!);
      }
      const result = await client!.publish(runId, token!);
      setMessage(result.newlyPublished ? "Published." : "Already published.");
    });

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

  // Whether the run can be published: it carries at least one review (an existing
  // one or one just submitted this session). The backend is the real gate.
  const canPublish = reviews.length > 0 || submittedThisSession || solo;

  const item = items[current];
  const draft = item ? (verdicts[item.id] ?? { status: "", note: "" }) : null;
  const expected = item?.reference
    ? referencesByView.get(item.reference)
    : undefined;
  const submitted = item?.proof ? proofsById.get(item.proof) : undefined;

  return (
    <Panel>
      {/* The run's existing reviews and the aggregate rating + score, so a
          reviewer sees what others recorded before adding their own. */}
      <ExistingReviews reviews={reviews} items={items} />

      {/* Mutating actions are gated on being signed in. Signing in and managing
          the account live on their own pages (top-bar account control); here we
          only confirm who is reviewing, or link to the sign-in page. */}
      {account ? (
        <p className={styles.notice}>
          Reviewing as <strong>{account.displayName}</strong>.
        </p>
      ) : (
        <p className={`${styles.notice} ${styles.warn}`}>
          <Link to={routes.login(routes.runDetail(runId))}>Sign in</Link> to
          push, review, and publish this run.
        </p>
      )}

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

            {/* For an asset-generation item that names sheet sequences/frames, the
                relevant animations and frames inline (with an Animation/Frames
                toggle) so the reviewer checks the item against exactly the assets
                it is about, without leaving the question. */}
            {asset &&
              ((item.sequences?.length ?? 0) > 0 ||
                (item.frames?.length ?? 0) > 0) && (
                <ReviewItemAssets
                  key={item.id}
                  asset={asset}
                  sequences={item.sequences ?? []}
                  frames={item.frames ?? []}
                />
              )}

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

      {(() => {
        const reviewReady = writeup.trim() !== "" && allAddressed && allRated;
        const reviewTitle = reviewReady
          ? undefined
          : "Write a review, rate every domain, and give every checklist item a verdict first";
        const needAccount = !account || !token;
        // The solo desktop path offers a standalone Push (release the run without
        // a review, so it need not be reviewed first) alongside a single Publish
        // that saves the review and pushes + publishes in one step. The web flow
        // splits into push, submit review, and publish (the last gated on the run
        // having a review).
        if (solo) {
          return (
            <div className={styles.actions}>
              <button
                className={styles.secondary}
                onClick={onPush}
                disabled={busy || needAccount || pushed}
                title={
                  needAccount
                    ? "Sign in to push"
                    : pushed
                      ? "Already pushed"
                      : "Release this run's source and build, storing it privately — no review needed"
                }
              >
                {pushed ? "Pushed" : "Push run"}
              </button>
              <button
                className={styles.primary}
                onClick={onPublish}
                disabled={busy || needAccount || !reviewReady}
                title={needAccount ? "Sign in to publish" : reviewTitle}
              >
                Publish run
              </button>
            </div>
          );
        }
        return (
          <div className={styles.actions}>
            <button
              className={styles.secondary}
              onClick={onPush}
              disabled={busy || needAccount || pushed}
              title={
                needAccount
                  ? "Sign in to push"
                  : pushed
                    ? "Already pushed"
                    : "Release this run's source and build, storing it privately"
              }
            >
              {pushed ? "Pushed" : "Push run"}
            </button>
            <button
              className={styles.secondary}
              onClick={onSubmitReview}
              disabled={busy || needAccount || !pushed || !reviewReady}
              title={
                needAccount
                  ? "Sign in to review"
                  : !pushed
                    ? "Push the run before reviewing it"
                    : reviewTitle
              }
            >
              Submit review
            </button>
            <button
              className={styles.primary}
              onClick={onPublish}
              disabled={busy || needAccount || !canPublish}
              title={
                needAccount
                  ? "Sign in to publish"
                  : !canPublish
                    ? "Submit at least one review before publishing"
                    : undefined
              }
            >
              Publish run
            </button>
          </div>
        );
      })()}

      {message && <p className={`${styles.notice} ${styles.ok}`}>{message}</p>}
      {error && <p className={`${styles.notice} ${styles.error}`}>{error}</p>}
    </Panel>
  );
}

// The run's existing reviews and the aggregate verdict, shown above the editor so
// a reviewer sees what others recorded. The aggregate rating is the worst any
// reviewer gave any domain ({@link aggregateRating}); the aggregate score is the
// mean earned over the case's checklist across reviews ({@link aggregateScore}),
// when the scoring model is available.
function ExistingReviews({
  reviews,
  items,
}: {
  reviews: StoredReview[];
  items: ReviewItem[];
}) {
  if (reviews.length === 0) return null;

  const aggRating = aggregateRating(reviews.map((r) => r.ratings));
  const aggScore =
    items.length > 0
      ? aggregateScore(reviews.map((r) => scoreChecklist(items, r.checklist)))
      : null;

  return (
    <div className={styles.field}>
      <p className={styles.sectionLabel}>
        {reviews.length} review{reviews.length === 1 ? "" : "s"}
      </p>
      <div className={styles.actions}>
        {aggRating && (
          <span title="Aggregate rating (worst across all reviews)">
            <RatingBadge rating={aggRating} />
          </span>
        )}
        {aggScore && (
          <span className={styles.muted}>
            {aggScore.earned.toFixed(1)} / {aggScore.total} pts (avg of{" "}
            {aggScore.reviews})
          </span>
        )}
      </div>
      <ul>
        {reviews.map((review) => {
          const overall = worstRating(review.ratings.map((r) => r.rating));
          return (
            <li key={review.reviewerId || review.reviewer}>
              <strong>{review.reviewer}</strong>
              {overall && (
                <>
                  {" — "}
                  <RatingBadge rating={overall} />
                </>
              )}
              {review.writeup.trim() && (
                <p className={styles.muted}>{review.writeup.trim()}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
