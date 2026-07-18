import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { GradeBadge, Panel, RatingBadge } from "@test-cabinet/ui";
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
import type { RunRecord } from "@test-cabinet/run-record";
import {
  useGalleryData,
  type ValidationMedia,
} from "../../../data/galleryContext";
import { MediaView } from "../../../components/MediaView";
import { ReviewItemAssets } from "./AssetResultSection";
import { DebugScriptList } from "./DebugScriptList";
import {
  GRADE_LEVELS,
  GRADE_META,
  GRADE_MAX_POINTS,
  OVERALL_VERDICT_ID,
  RATINGS,
  RATING_META,
  VERDICT_META,
  aggregateOverallGrade,
  aggregateRating,
  aggregateScore,
  formatPoints,
  isGrade,
  isRating,
  scoreChecklist,
  subItemVerdictId,
  verdictIdsForItem,
  type GradeStatus,
  type Rating,
} from "../../../data/ratings";
import { ReviewList } from "./ReviewList";
import styles from "../RunExec.module.scss";

/**
 * One auto-decided verdict from a run's debug scripts, keyed for pre-fill lookup by
 * verdict id (a review item's own id, or the `<item>.<sub>` composite).
 */
interface AutoVerdictInfo {
  status: VerdictStatus;
  note: string;
}

/**
 * The auto verdicts a run's debug scripts decided, keyed by verdict id. The
 * reviewer's checklist pre-fills from these (binary pass/fail), shown desaturated
 * until the reviewer overrides one. Empty when the case declares no automated
 * validation.
 */
function autoVerdictMap(run: RunRecord): Map<string, AutoVerdictInfo> {
  const map = new Map<string, AutoVerdictInfo>();
  for (const script of run.validation.debugScripts ?? []) {
    for (const v of script.verdicts) {
      map.set(v.id, { status: v.pass ? "pass" : "fail", note: v.note ?? "" });
    }
  }
  return map;
}

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

/**
 * The points label for a checklist item: a binary item shows its flat weight
 * (`2 pts`); a graded game-jam category shows what it earned over its available
 * `weight × 10` (`5 / 10 pts`), 0 when not yet graded.
 */
function itemPoints(
  item: { weight: number; graded?: boolean },
  status: VerdictStatus | "" | undefined,
): string {
  if (!item.graded) return pts(item.weight);
  const available = item.weight * GRADE_MAX_POINTS;
  const earned =
    status && isGrade(status) ? GRADE_META[status].points * item.weight : 0;
  return `${earned} / ${available} pts`;
}

// A five-button emoji grade picker (💩🙁😐😀💎), the graded analogue of the
// Pass/Fail verdict control: radio-like buttons with a roving tabindex + arrow
// keys, and clicking the selected option clearing it back to unset. Used for a
// game jam's category grades and its single whole-game overall grade.
function GradeChoice({
  value,
  onChange,
  ariaLabel,
}: {
  value: GradeStatus | "";
  onChange: (next: GradeStatus | "") => void;
  ariaLabel: string;
}) {
  return (
    <div
      className={styles.verdictChoice}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {GRADE_LEVELS.map((g, i) => {
        const selected = value === g;
        const meta = GRADE_META[g];
        return (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${meta.label} (${meta.points} ${meta.points === 1 ? "pt" : "pts"})`}
            title={`${meta.label} — ${meta.points} ${meta.points === 1 ? "pt" : "pts"}`}
            tabIndex={selected || (!value && i === 0) ? 0 : -1}
            className={`${styles.verdictOption} ${styles.gradeOption}${
              selected ? ` ${styles.verdictOptionActive}` : ""
            }`}
            onClick={() => onChange(selected ? "" : g)}
            onKeyDown={(e) => {
              const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
              const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
              if (!forward && !back) return;
              e.preventDefault();
              const nextIndex =
                (i + (forward ? 1 : GRADE_LEVELS.length - 1)) %
                GRADE_LEVELS.length;
              onChange(GRADE_LEVELS[nextIndex]!);
              const group = e.currentTarget.parentElement;
              (group?.children[nextIndex] as HTMLElement | undefined)?.focus();
            }}
          >
            <span aria-hidden="true">{meta.emoji}</span>
          </button>
        );
      })}
    </div>
  );
}

// The editable Verdict mode for a produced run the active worker owns: rate it,
// work the case's declared checklist one item at a time, write the review, and
// drive it through the review -> publish lifecycle. A produced run's record is
// already stored privately on the backend (the driver submits it when the run
// finishes), so a run is reviewable as soon as it is produced and can be published
// once it carries at least one review. On the web flow these are two distinct
// actions (Submit review / Publish). The desktop's local core folds review +
// publish into one *solo* command, so there the editor offers a single
// "Publish run" that saves the review and publishes in one step.
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
  run,
  reviews,
  onChanged,
}: {
  run: RunRecord;
  /** The run's reviews, fetched with the record by the run-detail layout — the
   * editor seeds from the current account's prior review and gates Publish on the
   * run carrying at least one. */
  reviews: StoredReview[];
  onChanged: () => void;
}) {
  const runId = run.id;
  const subject = run.subject;
  const { active: worker } = useWorkers();
  const client = worker?.client ?? null;
  // The desktop's local worker collapses review/publish into one solo command, so
  // the editor offers a single Publish action there.
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
  // The current account's own prior review (when any) among the run's reviews —
  // the seed for re-reviewing. The reviews arrive from the run-detail layout,
  // fetched with the record.
  const ownReview = useMemo(
    () => reviews.find((r) => account && r.reviewerId === account.id),
    [reviews, account],
  );
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [writeup, setWriteup] = useState(ownReview?.writeup ?? "");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, VerdictDraft>>({});
  // A game jam's whole-game overall grade (the reserved OVERALL_VERDICT_ID verdict),
  // held apart from the item-keyed `verdicts` because it is not a declared item. ""
  // until the reviewer picks a grade. Empty for a non-jam review.
  const [overall, setOverall] = useState<GradeStatus | "">("");
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reviews this account has submitted this session, so Publish enables without a
  // refetch right after submitting.
  const [submittedThisSession, setSubmittedThisSession] = useState(false);
  // Whether the review form is open. A reviewer who has not yet reviewed this run
  // sees it open to write their first review; once they carry one it collapses to
  // the summary so the form is not in the way of publishing. Deriving the
  // effective `showForm` from this OR "has no own review" keeps the form open
  // while `ownReview` is still resolving (account/reviews loading). The
  // single-review page's Edit control reopens it for a re-review by linking back
  // here with `?edit=1`, which seeds this open.
  const [searchParams] = useSearchParams();
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");

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
    const map = new Map<string, ProofMedia>();
    for (const proof of gallery.proofMediaFor(run)) map.set(proof.id, proof);
    return map;
  }, [gallery, run]);

  // For an asset-generation run, its resolved result (frames + sprite sheet) so a
  // checklist item that names sequences/frames can show exactly those assets
  // beside the question — no scrolling up to the generated-asset section. Null for
  // a non-asset run.
  const asset = useMemo(() => gallery.assetResultFor(run), [gallery, run]);

  // The auto verdicts this run's debug scripts decided, keyed by verdict id. The
  // checklist pre-fills from these (an objective mechanic either fired or it did
  // not), shown desaturated until the reviewer overrides one. Empty for a case with
  // no automated validation.
  const auto = useMemo(() => autoVerdictMap(run), [run]);
  // The debug scripts that ran, for the run-list surfaced atop the editor.
  const debugScripts = useMemo(() => run.validation.debugScripts ?? [], [run]);
  // The verdict ids currently holding their pre-filled auto value (i.e. the reviewer
  // has not overridden them this session). A verdict in this set renders in the
  // desaturated auto variant; touching its Pass/Fail control drops it from the set,
  // flipping it to full color as a manual override. Seeded alongside the drafts.
  const [autoVerdictIds, setAutoVerdictIds] = useState<Set<string>>(new Set());

  // The run's automated-validation media (actual build vs reference baseline),
  // grouped by the verdict id each output backs (the item's own id, or the composite
  // `<item>.<sub>` for a sub-item), so each verdict row can show the pair(s) that
  // validate it side by side — a sub-divided item shows each sub-item's own proof.
  const validationByVerdict = useMemo(() => {
    const map = new Map<string, ValidationMedia[]>();
    for (const media of gallery.validationMediaFor(run)) {
      const list = map.get(media.verdictId);
      if (list) list.push(media);
      else map.set(media.verdictId, [media]);
    }
    return map;
  }, [gallery, run]);

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
        // Verdicts are keyed by verdict id — the item's own id when it is graded
        // as a whole, or a `<item>.<sub>` composite per sub-item. Seed each draft
        // from, in precedence: the account's own prior verdict of the same id (a
        // re-review keeps the reviewer's earlier call, a manual value); otherwise
        // this run's auto verdict (pre-filled and marked auto-set); otherwise unset.
        const drafts: Record<string, VerdictDraft> = {};
        const autoIds = new Set<string>();
        for (const item of loaded) {
          for (const vid of verdictIdsForItem(item)) {
            const existing = prior.get(vid);
            if (existing) {
              drafts[vid] = {
                status: existing.status,
                note: existing.note ?? "",
              };
              continue;
            }
            const autoVerdict = auto.get(vid);
            if (autoVerdict) {
              drafts[vid] = { ...autoVerdict };
              autoIds.add(vid);
              continue;
            }
            drafts[vid] = { status: "", note: "" };
          }
        }
        setItems(loaded);
        setVerdicts(drafts);
        setAutoVerdictIds(autoIds);
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

  // Seed the writeup from the account's own prior review, re-seeding when the
  // account resolves (it can load after mount). Mirrors the rating/verdict
  // seeding above so an existing reviewer's prose is restored when they reopen
  // the form to revise — the form may be collapsed until then.
  useEffect(() => {
    setWriteup(ownReview?.writeup ?? "");
    // Seed when the account changes; `ownReview` is the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  // Seed the whole-game overall grade (a game-jam review) from the account's own
  // prior review's reserved OVERALL_VERDICT_ID verdict, re-seeding when the account
  // resolves. Empty when the prior review recorded no (valid) overall grade.
  useEffect(() => {
    const prior = (ownReview?.checklist ?? []).find(
      (v) => v.id === OVERALL_VERDICT_ID,
    );
    setOverall(prior && isGrade(prior.status) ? prior.status : "");
    // Seed when the account changes; `ownReview` is the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  // An item is fully addressed once every one of its verdict ids (its own, or one
  // per sub-item) carries a status. The publish gate and the rail's progress count
  // both require every item to be addressed.
  // A game jam grades its review categories on the five-level emoji scale and has
  // no scoring domains; every category carries `graded`, so the presence of a
  // graded item makes this a jam review. The two scales never mix within a case.
  const jam = items.some((it) => it.graded);
  const itemAddressed = (item: ReviewItem) =>
    verdictIdsForItem(item).every((vid) => verdicts[vid]?.status);
  const allAddressed = items.every(itemAddressed);
  // A jam is fully rated once the whole-game overall grade is picked (it has no
  // domains); a domain-scored case once every domain carries a rating.
  const allRated = jam
    ? overall !== ""
    : domains.every((domain) => ratings[domain.id]);
  const answeredCount = items.filter(itemAddressed).length;

  function setVerdict(id: string, patch: Partial<VerdictDraft>) {
    // Explicitly setting a verdict's Pass/Fail is a manual override: drop it from
    // the auto-set group so it renders in full color rather than the desaturated
    // auto variant. Editing only the note leaves the auto marking intact — the note
    // is pre-filled from the script and expected to be tweaked.
    if (patch.status !== undefined) {
      setAutoVerdictIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
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

  // The pass/fail control (and its optional note) for one gradable unit, keyed by
  // its verdict id — the item's own id, or a `<item>.<sub>` composite for a
  // sub-item. Shared so a whole-item verdict and each sub-item's verdict use the
  // identical radiogroup: Pass/Fail as two radio-like buttons, a roving tabindex +
  // arrow keys, and clicking the selected option clearing it back to unset.
  function renderVerdict(verdictId: string) {
    const d = verdicts[verdictId] ?? { status: "", note: "" };
    // Whether this verdict is still holding its pre-filled auto value (the reviewer
    // has not overridden it). Its selected option renders desaturated to mark it as
    // machine-set rather than reviewer-set.
    const isAuto = autoVerdictIds.has(verdictId);
    // The automated-validation media backing exactly this verdict (the reference
    // baseline beside this run's actual), so the reviewer can visually verify the
    // point — for a sub-item, its own proof rather than a shared item-level clip.
    const media = validationByVerdict.get(verdictId) ?? [];
    return (
      <>
        {media.map((m) => (
          <ValidationMediaPair key={m.id} media={m} />
        ))}
        <div className={styles.checklistControls}>
          <div
            className={styles.verdictChoice}
            role="radiogroup"
            aria-label="Verdict"
          >
            {STATUSES.map((s, i) => {
              const selected = d.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected || (!d.status && i === 0) ? 0 : -1}
                  className={`${styles.verdictOption} ${
                    s === "pass"
                      ? styles.verdictOptionPass
                      : styles.verdictOptionFail
                  }${selected ? ` ${styles.verdictOptionActive}` : ""}${
                    selected && isAuto ? ` ${styles.verdictOptionAuto}` : ""
                  }`}
                  title={
                    selected && isAuto
                      ? "Auto-set from this run's debug script — click to override"
                      : undefined
                  }
                  onClick={() =>
                    setVerdict(verdictId, { status: selected ? "" : s })
                  }
                  onKeyDown={(e) => {
                    const forward =
                      e.key === "ArrowRight" || e.key === "ArrowDown";
                    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
                    if (!forward && !back) return;
                    e.preventDefault();
                    const nextIndex =
                      (i + (forward ? 1 : STATUSES.length - 1)) %
                      STATUSES.length;
                    setVerdict(verdictId, { status: STATUSES[nextIndex] });
                    const group = e.currentTarget.parentElement;
                    (
                      group?.children[nextIndex] as HTMLElement | undefined
                    )?.focus();
                  }}
                >
                  {VERDICT_META[s].label}
                </button>
              );
            })}
          </div>
          <input
            className={styles.input}
            value={d.note}
            onChange={(e) => setVerdict(verdictId, { note: e.target.value })}
            placeholder="note (optional)"
          />
        </div>
      </>
    );
  }

  // The graded (game-jam) counterpart of {@link renderVerdict}: the five-emoji
  // grade picker plus the same optional note, keyed by the item's verdict id.
  function renderGradeVerdict(verdictId: string) {
    const d = verdicts[verdictId] ?? { status: "", note: "" };
    return (
      <div className={styles.checklistControls}>
        <GradeChoice
          value={isGrade(d.status) ? d.status : ""}
          onChange={(next) => setVerdict(verdictId, { status: next })}
          ariaLabel="Grade"
        />
        <input
          className={styles.input}
          value={d.note}
          onChange={(e) => setVerdict(verdictId, { note: e.target.value })}
          placeholder="note (optional)"
        />
      </div>
    );
  }

  // Shortcut for a run that does not launch at all: fail every checklist item and
  // rate every domain the worst tier, so an unplayable run can be submitted in one
  // step without walking each question. Purely local state — it flows through the
  // normal buildReview()/submit path and fills the submit gate. Confirmed first
  // because it overwrites every verdict and rating already recorded.
  function markUnplayable() {
    if (
      !window.confirm(
        jam
          ? "Mark this run unplayable? Every category and the overall grade will be set to 💩 Broken."
          : "Mark this run unplayable? Every checklist item will be set to Fail and every rating to Broken.",
      )
    )
      return;
    // A jam grades every category (and the overall) as the worst tier, `broken`; a
    // domain-scored case fails every item and rates every domain the worst tier.
    const worst: VerdictStatus = jam ? "broken" : "fail";
    // Marking unplayable is a deliberate reviewer action, so every verdict it sets
    // is a manual override — clear the auto-set marking wholesale.
    setAutoVerdictIds(new Set());
    setVerdicts((prev) => {
      const next: Record<string, VerdictDraft> = {};
      for (const it of items) {
        for (const vid of verdictIdsForItem(it)) {
          const base = prev[vid] ?? { status: "", note: "" };
          next[vid] = { ...base, status: worst };
        }
      }
      return next;
    });
    if (jam) {
      setOverall("broken");
    } else {
      setRatings(() => {
        const next: Record<string, Rating> = {};
        for (const domain of domains) next[domain.id] = "broken";
        return next;
      });
    }
  }

  function buildChecklist(): ReviewVerdict[] {
    // One verdict per verdict id: the item's own when graded as a whole, or one
    // per sub-item (keyed by the `<item>.<sub>` composite) when it has sub-items.
    const verdictList = items.flatMap((item) =>
      verdictIdsForItem(item).map((vid) => {
        const draft = verdicts[vid] ?? { status: "", note: "" };
        const note = draft.note.trim();
        return {
          id: vid,
          status: draft.status as VerdictStatus,
          ...(note ? { note } : {}),
        };
      }),
    );
    // A jam rides its whole-game overall grade in the same checklist, under the
    // reserved OVERALL_VERDICT_ID (excluded from the point score by the scorer).
    if (jam && overall) {
      verdictList.push({ id: OVERALL_VERDICT_ID, status: overall });
    }
    return verdictList;
  }

  // The reviewer's input as the worker contract carries it. A jam has no scoring
  // domains, so it submits no per-domain ratings — its graded categories, overall
  // grade, and writeup are the whole review.
  function buildReview() {
    return {
      ratings: jam
        ? []
        : domains.map((domain) => ({
            domain: domain.id,
            rating: ratings[domain.id] ?? "great",
          })),
      writeup,
      checklist: buildChecklist(),
    };
  }

  // Run a mutating lifecycle action, wrapping it in the busy/error/message
  // plumbing so each button shares one path.
  async function runAction(label: string, action: () => Promise<void>) {
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

  // Submit review: attribute this account's review to the run (web flow). On the
  // solo desktop path this saves the local draft.
  const onSubmitReview = () =>
    runAction("Review submitted.", async () => {
      await client!.submitReview(runId, buildReview(), token!);
      setSubmittedThisSession(true);
      // Collapse back to the summary; the just-submitted review now shows there.
      setEditing(false);
    });

  // Publish: clear the gate (web flow). On the solo desktop path this saves the
  // review and runs review + publish in one step.
  const onPublish = () =>
    runAction("Published.", async () => {
      if (solo) {
        await client!.submitReview(runId, buildReview(), token!);
      }
      // Publishing is asynchronous: enqueue and observe the release over its live
      // stream, surfacing each progress line, then confirm on the terminal result.
      setMessage("Publishing…");
      const result = await client!.publish(runId, token!, (progress) => {
        setMessage(`Publishing… ${progress.message}`);
      });
      setMessage(result.published ? "Published." : "Publish did not complete.");
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

  // Show the form when re-reviewing (Edit) or when this account has no review yet
  // — so a first-time reviewer always lands on the form, and a reviewer who has
  // already weighed in sees only the summary until they choose to revise.
  const showForm = editing || !ownReview;
  // Offered while revising an existing review, to back out without changing it.
  const cancelButton =
    editing && ownReview ? (
      <button
        type="button"
        className={styles.secondary}
        onClick={() => setEditing(false)}
        disabled={busy}
      >
        Cancel
      </button>
    ) : null;

  const item = items[current];
  // Whether the current item has any automated-validation media — on the item itself
  // (validated as a whole) or on any of its sub-items. When it does, the item's
  // synthesized actual-vs-baseline pairs (rendered per verdict row by `renderVerdict`)
  // replace the item-level expected/submitted panes.
  const itemHasValidationMedia = item
    ? verdictIdsForItem(item).some((vid) => validationByVerdict.has(vid))
    : false;
  // The live score from the current effective verdicts (auto pre-fills plus any
  // overrides), so the reviewer sees the running total before submitting. Mirrors
  // how the published verdict scores its checklist.
  const liveScore =
    items.length > 0 ? scoreChecklist(items, buildChecklist()) : null;

  // The expected-reference-beside-submitted-proof panes for one checklist point.
  // Shared by an item validated as a whole (the legacy grammar pairs media on the
  // item) and each review item under a category (the categories grammar pairs media
  // on the item, not the category). Each pane shows only when that side exists — a
  // point may declare just a proof — and returns `null` when it declares neither.
  function mediaPanesFor(
    reference: string | null | undefined,
    proof: string | null | undefined,
  ) {
    const exp = reference ? referencesByView.get(reference) : undefined;
    const proofMedia = proof ? proofsById.get(proof) : undefined;
    if (!exp && !proof) return null;
    return (
      <div
        className={`${styles.mediaPanes}${
          exp && proof ? "" : ` ${styles.mediaPanesSingle}`
        }`}
      >
        {exp && (
          <figure className={styles.mediaPane}>
            <figcaption className={styles.mediaPaneLabel}>Expected</figcaption>
            <MediaView
              kind={exp.kind}
              url={exp.url}
              alt={`Expected ${reference}`}
            />
          </figure>
        )}
        {proof && (
          <figure className={styles.mediaPane}>
            <figcaption className={styles.mediaPaneLabel}>Submitted</figcaption>
            {proofMedia && proofMedia.present && proofMedia.url ? (
              <MediaView
                kind={proofMedia.kind}
                url={proofMedia.url}
                alt={`Submitted ${proof}`}
              />
            ) : (
              <p className={styles.mediaMissing}>
                {proofMedia && !proofMedia.present
                  ? "The agent did not submit this proof."
                  : "Proof media is not available here."}
              </p>
            )}
          </figure>
        )}
      </div>
    );
  }

  return (
    <Panel>
      {/* The run's existing reviews and the aggregate rating + score, so a
          reviewer sees what others recorded before adding their own. Each review
          links to its own page, where the active account's own review carries the
          Edit control that reopens this form to revise it. */}
      <ExistingReviews reviews={reviews} items={items} runId={runId} />

      {/* The instrumentation debug scripts this run's automated-validation items
          declare: which ran to completion against a conformant build (the debug-API
          gate) and the detail of any failure. This is reference context, not a task
          for the reviewer — the automated validation already pre-fills the checklist
          verdicts, so surfacing it while the review is still being written only buries
          the form the reviewer is here to complete. Show it only once a review has
          been submitted for this run, where it stands as evidence behind the verdict. */}
      {debugScripts.length > 0 &&
        (reviews.length > 0 || submittedThisSession) && (
          <DebugScriptList
            scripts={debugScripts}
            heading="Automated validation"
          />
        )}

      {/* The review form proper — the checklist questions, the writeup, and the
          per-domain ratings — shown only while writing or revising a review. */}
      {showForm && (
        <>
          {/* Mutating actions are gated on being signed in. Signing in and
              managing the account live on their own pages (top-bar account
              control); while reviewing we only confirm who is reviewing, or link
              to the sign-in page. */}
          {account ? (
            <p className={styles.notice}>
              Reviewing as <strong>{account.displayName}</strong>.
            </p>
          ) : (
            <p className={`${styles.notice} ${styles.warn}`}>
              <Link to={routes.login(routes.runDetail(runId))}>Sign in</Link> to
              review and publish this run.
            </p>
          )}

          {/* The live, auto-calculated score from the current effective verdicts.
              Auto verdicts pre-fill the checklist, so this reflects a running total
              before the reviewer submits; overriding a verdict updates it live. */}
          {liveScore && !jam && (
            <p className={styles.notice}>
              Live score:{" "}
              <strong>
                {formatPoints(liveScore.earned)} / {liveScore.total} pts
              </strong>
              {autoVerdictIds.size > 0 && (
                <span className={styles.muted}>
                  {" "}
                  — {autoVerdictIds.size} verdict
                  {autoVerdictIds.size === 1 ? "" : "s"} auto-set from this
                  run's debug scripts (shown desaturated; click to override)
                </span>
              )}
            </p>
          )}

          {item && (
            <div className={styles.reviewLayout}>
              {/* The navigable rail of every checklist item; answered items are
              marked done, the current one highlighted. */}
              <nav className={styles.itemRail} aria-label="Checklist items">
                <p className={styles.sectionLabel}>
                  {answeredCount}/{items.length} addressed
                </p>
                {/* Fail everything at once for a run that never launched. */}
                <button
                  type="button"
                  className={styles.unplayable}
                  onClick={markUnplayable}
                  disabled={busy}
                  title={
                    jam
                      ? "Mark the whole run unplayable — grade every category and the overall as Broken"
                      : "Mark the whole run unplayable — set every checklist item to Fail and every rating to Broken"
                  }
                  aria-label={
                    jam
                      ? "Mark the whole run unplayable: every category and the overall grade are Broken"
                      : "Mark the whole run unplayable: every checklist item fails and every rating is broken"
                  }
                >
                  Mark unplayable
                </button>
                {/* An accordion of categories: each top-level item is a rail row,
                and the current one — when it is a category of review items —
                expands to list its items, each jumping to its point in the panel.
                A legacy item with no sub-items is a plain leaf row. */}
                <ol className={styles.itemNavList}>
                  {items.map((it, index) => {
                    // Aggregate the item's verdict ids (its own, or one per
                    // sub-item) into a single rail mark: fully addressed and all
                    // passing shows a check, fully addressed with any fail shows a
                    // cross, otherwise the item's number.
                    const statuses = verdictIdsForItem(it).map(
                      (vid) => verdicts[vid]?.status ?? "",
                    );
                    const answered = statuses.every(Boolean);
                    // A graded (jam) category has no "fail"; it reads as addressed
                    // (✓) once graded, its emoji shown in the question itself.
                    const anyFail = statuses.some((s) => s === "fail");
                    const isCurrent = index === current;
                    const mark = !answered ? index + 1 : anyFail ? "✕" : "✓";
                    const title = !answered
                      ? undefined
                      : jam
                        ? it.title
                        : `${it.title} — ${anyFail ? "some Fail" : "all Pass"}`;
                    const subItems = it.graded ? [] : (it.subItems ?? []);
                    const expanded = isCurrent && subItems.length > 0;
                    return (
                      <li key={it.id}>
                        <button
                          type="button"
                          className={`${styles.itemNav}${
                            isCurrent ? ` ${styles.itemNavActive}` : ""
                          }${answered ? ` ${styles.itemNavDone}` : ""}${
                            answered && anyFail ? ` ${styles.itemNavFail}` : ""
                          }`}
                          onClick={() => setCurrent(index)}
                          aria-current={isCurrent ? "true" : undefined}
                          aria-expanded={
                            subItems.length > 0 ? expanded : undefined
                          }
                          title={title}
                        >
                          {/* The mark reflects the verdict: a check when every
                          point passed, a cross when any failed, else the number. */}
                          <span
                            className={styles.itemNavMark}
                            aria-hidden="true"
                          >
                            {mark}
                          </span>
                          <span className={styles.itemNavTitle}>
                            {it.title} (
                            {itemPoints(it, verdicts[it.id]?.status)})
                          </span>
                        </button>
                        {expanded && (
                          <ol className={styles.subNavList}>
                            {subItems.map((sub, si) => {
                              const st =
                                verdicts[subItemVerdictId(it.id, sub.id)]
                                  ?.status ?? "";
                              const subMark = !st
                                ? `${String.fromCharCode(97 + si)}.`
                                : st === "fail"
                                  ? "✕"
                                  : "✓";
                              return (
                                <li key={sub.id}>
                                  <button
                                    type="button"
                                    className={`${styles.subNav}${
                                      st ? ` ${styles.subNavDone}` : ""
                                    }${
                                      st === "fail"
                                        ? ` ${styles.subNavFail}`
                                        : ""
                                    }`}
                                    onClick={() =>
                                      document
                                        .getElementById(
                                          `review-sub-${it.id}-${sub.id}`,
                                        )
                                        ?.scrollIntoView({
                                          behavior: "smooth",
                                          block: "center",
                                        })
                                    }
                                  >
                                    <span
                                      className={styles.subNavMark}
                                      aria-hidden="true"
                                    >
                                      {subMark}
                                    </span>
                                    <span className={styles.subNavTitle}>
                                      {sub.title}
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ol>
                        )}
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
                  {item.title} ({itemPoints(item, verdicts[item.id]?.status)})
                </span>
                {/* A category (categories grammar) carries no prose of its own —
                its `text` is empty and each review item states its own below. */}
                {item.text && (
                  <span className={styles.checklistText}>{item.text}</span>
                )}

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

                {/* Automated-validation media (reference baseline beside this run's
                actual) renders per verdict row inside the verdict controls below — on
                the whole-item control for an item validated as a whole, or beside each
                sub-item's control for a sub-divided item — so each point shows its own
                proof rather than one shared item-level clip. */}

                {/* Expected reference beside submitted proof. Each pane shows only
                when that side exists — an item may declare just a proof (e.g. a
                video clip with no still that depicts it), so it takes the full
                width rather than reserving an empty Expected column. Suppressed for
                a validated item, whose actual-vs-baseline pairs stand in its place. */}
                {!itemHasValidationMedia &&
                  mediaPanesFor(item.reference, item.proof)}

                {/* Record a verdict. A game-jam category is graded on the five-emoji
                scale. Otherwise: an item graded as a whole gets one Pass/Fail
                control; a category is graded per review item, each a row (lettered
                a, b, c…) carrying its own description, paired media, and control, so
                the category's weight is spread across independently scored points. */}
                {item.graded ? (
                  renderGradeVerdict(item.id)
                ) : item.subItems && item.subItems.length > 0 ? (
                  <ol className={styles.subItemList}>
                    {item.subItems.map((sub, i) => {
                      const vid = subItemVerdictId(item.id, sub.id);
                      return (
                        <li
                          key={sub.id}
                          id={`review-sub-${item.id}-${sub.id}`}
                          className={styles.subItem}
                        >
                          <span className={styles.subItemTitle}>
                            <span className={styles.subItemLetter}>
                              {String.fromCharCode(97 + i)}.
                            </span>{" "}
                            {sub.title}
                          </span>
                          {sub.description && (
                            <span className={styles.checklistText}>
                              {sub.description}
                            </span>
                          )}
                          {/* A review item pairs its own expected/submitted media
                          (unless an auto-validation actual-vs-baseline pair, rendered
                          by `renderVerdict`, stands in its place). */}
                          {!validationByVerdict.has(vid) &&
                            mediaPanesFor(sub.reference, sub.proof)}
                          {renderVerdict(vid)}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  renderVerdict(item.id)
                )}

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

          {/* A game jam has no scoring domains: instead of per-domain ratings, the
          reviewer gives one whole-game overall grade on the five-emoji scale, which
          becomes the run's rating badge. Required for the review to be complete. */}
          {jam ? (
            <fieldset className={styles.ratings}>
              <legend className={styles.fieldLabel}>Overall grade</legend>
              <p className={styles.notice}>
                Your grade for the whole game — how good is this entry overall?
                Required.
              </p>
              <GradeChoice
                value={overall}
                onChange={setOverall}
                ariaLabel="Overall game grade"
              />
              {overall && (
                <span className={styles.muted}>
                  {GRADE_META[overall].emoji} {GRADE_META[overall].label}
                </span>
              )}
            </fieldset>
          ) : (
            /* One rating per scoring domain — the reviewer rates each independently
            and the run's overall rating is the worst across them. */
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
                  <span
                    className={styles.fieldLabel}
                    title={domain.description}
                  >
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
          )}
        </>
      )}

      {(() => {
        const reviewReady = writeup.trim() !== "" && allAddressed && allRated;
        const reviewTitle = reviewReady
          ? undefined
          : jam
            ? "Write a review, grade the whole game, and grade every category first"
            : "Write a review, rate every domain, and give every checklist item a verdict first";
        const needAccount = !account || !token;
        // The solo desktop path offers a single Publish that saves the review and
        // publishes in one step. The web flow splits into submit review and publish
        // (the latter gated on the run having a review). A produced run's record is
        // already stored on the backend (the driver pushes it on completion), so
        // neither flow has a separate push step.
        if (solo) {
          return (
            <div className={styles.actions}>
              <button
                className={styles.primary}
                onClick={onPublish}
                disabled={busy || needAccount || !reviewReady}
                title={needAccount ? "Sign in to publish" : reviewTitle}
              >
                Publish run
              </button>
              {cancelButton}
            </div>
          );
        }
        return (
          <div className={styles.actions}>
            {showForm && (
              <button
                className={styles.secondary}
                onClick={onSubmitReview}
                disabled={busy || needAccount || !reviewReady}
                title={needAccount ? "Sign in to review" : reviewTitle}
              >
                {ownReview ? "Update review" : "Submit review"}
              </button>
            )}
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
            {cancelButton}
          </div>
        );
      })()}

      {message && <p className={`${styles.notice} ${styles.ok}`}>{message}</p>}
      {error && <p className={`${styles.notice} ${styles.error}`}>{error}</p>}
    </Panel>
  );
}

// One automated-validation output shown as a side-by-side pair: the case's
// reference implementation (the baseline) beside this run's build (the actual), so
// a reviewer compares expected-vs-observed behavior for the mechanic the auto
// verdict judged. When only the actual side was produced it stands alone. For video
// outputs the pair shares one control — a "Play both" button that restarts and
// plays both clips together, and a loop toggle (on by default) — so the reference
// and the run stay synchronized while the reviewer watches. The two clips are muted
// so playing them together is not a cacophony.
function ValidationMediaPair({ media }: { media: ValidationMedia }) {
  const isVideo = media.kind === "video";
  const [loop, setLoop] = useState(true);
  const actualRef = useRef<HTMLVideoElement>(null);
  const baselineRef = useRef<HTMLVideoElement>(null);
  const hasBaseline = media.baselineUrl !== null;
  const hasActual = media.actualUrl !== null;

  // Restart and play both clips from the top together, so the reference and this
  // run advance frame-for-frame while the reviewer compares them.
  const playBoth = () => {
    for (const ref of [baselineRef, actualRef]) {
      const el = ref.current;
      if (el) {
        el.currentTime = 0;
        void el.play();
      }
    }
  };

  return (
    <figure className={styles.validationOutput}>
      <figcaption className={styles.validationOutputName}>
        {media.name}
      </figcaption>
      {isVideo && (hasActual || hasBaseline) && (
        <div className={styles.validationControls}>
          <button type="button" className={styles.secondary} onClick={playBoth}>
            ▶ Play both
          </button>
          <label className={styles.validationLoop}>
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />
            Loop
          </label>
        </div>
      )}
      <div
        className={`${styles.mediaPanes}${
          hasActual && hasBaseline ? "" : ` ${styles.mediaPanesSingle}`
        }`}
      >
        {hasBaseline && (
          <figure className={styles.mediaPane}>
            <figcaption className={styles.mediaPaneLabel}>Reference</figcaption>
            <MediaView
              kind={media.kind}
              url={media.baselineUrl!}
              alt={`Reference ${media.name}`}
              loop={loop}
              muted
              videoRef={baselineRef}
            />
          </figure>
        )}
        <figure className={styles.mediaPane}>
          <figcaption className={styles.mediaPaneLabel}>This run</figcaption>
          {hasActual ? (
            <MediaView
              kind={media.kind}
              url={media.actualUrl!}
              alt={`This run ${media.name}`}
              loop={loop}
              muted
              videoRef={actualRef}
            />
          ) : (
            <p className={styles.mediaMissing}>
              This run did not produce this output.
            </p>
          )}
        </figure>
      </div>
    </figure>
  );
}

// The run's existing reviews and the aggregate verdict, shown above the editor so
// a reviewer sees what others recorded. The header pairs the aggregate verdict —
// the worst rating any reviewer gave any domain ({@link aggregateRating}) and the
// mean earned over the case's checklist ({@link aggregateScore}, when the scoring
// model is available) — with the review count pushed to its right. Each review is
// a compact, clickable card linking to that review's own page, where the active
// account's own review carries the Edit control that reopens the form to revise it.
function ExistingReviews({
  reviews,
  items,
  runId,
}: {
  reviews: StoredReview[];
  items: ReviewItem[];
  runId: string;
}) {
  if (reviews.length === 0) return null;

  // A jam's rating badge is the aggregate overall grade (worst across reviews) in
  // place of the per-domain aggregate rating a domain-scored case shows.
  const jam = items.some((it) => it.graded);
  const aggRating = jam ? null : aggregateRating(reviews.map((r) => r.ratings));
  const aggGrade = jam
    ? aggregateOverallGrade(reviews.map((r) => r.checklist))
    : null;
  const aggScore =
    items.length > 0
      ? aggregateScore(reviews.map((r) => scoreChecklist(items, r.checklist)))
      : null;

  return (
    <div className={styles.reviewSummary}>
      {/* The aggregate verdict on the left, the review count pushed to the right
          on the same row. */}
      <div className={styles.reviewSummaryHeader}>
        <div className={styles.reviewSummaryVerdict}>
          {aggRating && (
            <span title="Aggregate rating (worst across all reviews)">
              <RatingBadge rating={aggRating} />
            </span>
          )}
          {aggGrade && (
            <span title="Aggregate overall grade (worst across all reviews)">
              <GradeBadge status={aggGrade} />
            </span>
          )}
          {aggScore && (
            <span className={styles.muted}>
              {aggScore.earned.toFixed(1)} / {aggScore.total} pts (avg of{" "}
              {aggScore.reviews})
            </span>
          )}
        </div>
        <span className={styles.reviewCount}>
          {reviews.length} review{reviews.length === 1 ? "" : "s"}
        </span>
      </div>

      <ReviewList reviews={reviews} items={items} runId={runId} />
    </div>
  );
}
