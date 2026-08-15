import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Avatar, GradeBadge, Panel, RatingBadge } from "@test-cabinet/ui";
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
import type { Assertion, RunRecord } from "@test-cabinet/run-record";
import {
  useGalleryData,
  type ValidationMedia,
} from "../../../data/galleryContext";
import { useTestCase } from "../../../data/useTestCase";
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
import {
  autoVerdictMap,
  overriddenAutoVerdictIds,
  type VerdictDraft,
} from "./autoVerdicts";
import styles from "../RunExec.module.scss";

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
  disabled = false,
}: {
  value: GradeStatus | "";
  onChange: (next: GradeStatus | "") => void;
  ariaLabel: string;
  disabled?: boolean;
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
            disabled={disabled}
            tabIndex={disabled ? -1 : selected || (!value && i === 0) ? 0 : -1}
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
// Publishing is a one-way door: once the run is public the editor drops the
// Publish action on both paths and keeps only the review controls, so a reviewer
// revising their own published review is never offered a second publish the
// backend would refuse. This lifecycle is identical for every test type — a game
// jam is reviewed and published exactly the way a test run is; only the shape of
// the review differs (graded categories plus a whole-game overall grade instead
// of per-domain ratings and pass/fail items).
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
  published,
  onChanged,
}: {
  run: RunRecord;
  /** The run's reviews, fetched with the record by the run-detail layout — the
   * editor seeds from the current account's prior review and gates Publish on the
   * run carrying at least one. */
  reviews: StoredReview[];
  /** Whether the run has already been published. A published run is public and
   * cannot be published again (the backend refuses it), so the editor drops the
   * Publish action entirely and offers only the review controls — a reviewer can
   * still revise their own review, which refreshes the public snapshot on its
   * own. */
  published: boolean;
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
  // The run's case, fetched by slug — the source of both the scoring domains
  // (rated independently; the run's overall rating is the worst across them) and
  // the variant's reference media below.
  const { testCase } = useTestCase(subject.testCaseSlug);
  const variant = useMemo(
    () => testCase?.variants.find((v) => v.slug === subject.variant),
    [testCase, subject.variant],
  );
  const domains = variant?.domains ?? testCase?.domains ?? [];
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
  // The reviewer's note explaining an edit, required when re-submitting a review that
  // already exists (the backend rejects a content-changing edit without one). Reset
  // after each successful submit so every edit carries its own fresh explanation.
  const [editNote, setEditNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reviews this account has submitted this session, so Publish enables without a
  // refetch right after submitting.
  const [submittedThisSession, setSubmittedThisSession] = useState(false);
  // Whether a publish succeeded this session, so the Publish action retires
  // immediately rather than waiting for the refreshed record to report the run as
  // published.
  const [publishedThisSession, setPublishedThisSession] = useState(false);
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
    const map = new Map<string, ReferenceShot>();
    for (const ref of variant?.referenceScreenshots ?? []) {
      map.set(ref.view, { view: ref.view, kind: ref.kind, url: ref.url });
    }
    return map;
  }, [variant]);

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
  // Whether the live-score bar's automated-check breakdown is expanded. The bar
  // summarizes how many of this run's debug scripts ran; expanding it reveals the
  // same per-script pass/fail list the Verdict tab shows once a review is submitted,
  // so a reviewer can see at a glance when (e.g.) zero checks ran on a build.
  const [checksExpanded, setChecksExpanded] = useState(false);

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

  // The assertions each debug script recorded on its way to a verdict — the
  // individual mechanical facts it checked, each pass or fail and each carrying its
  // own detail (e.g. "the match ends at 11-9", "x=469 < 480") — keyed by the verdict
  // id they back (the item's own id, or the composite `<item>.<sub>`). These are the
  // proof behind an auto-set pass/fail, shown inline beneath the verdict so the
  // reviewer sees exactly what was observed — and which parts held or failed — right
  // where they are deciding, rather than only in the separate automated-validation
  // list (which the Verdict tab withholds until a review is submitted).
  const assertionsByVerdict = useMemo(() => {
    const map = new Map<string, Assertion[]>();
    for (const script of run.validation.debugScripts ?? []) {
      for (const v of script.verdicts) {
        if (v.assertions.length === 0) continue;
        const list = map.get(v.id);
        if (list) list.push(...v.assertions);
        else map.set(v.id, [...v.assertions]);
      }
    }
    return map;
  }, [run]);

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
        // re-review keeps the reviewer's earlier call); otherwise this run's auto
        // verdict (pre-filled); otherwise unset. Either way a draft that agrees
        // with what validation decided is marked auto-set, so re-opening a review
        // shows at a glance which points still stand on the machine's call and
        // which the reviewer overrode.
        const drafts: Record<string, VerdictDraft> = {};
        const autoIds = new Set<string>();
        for (const item of loaded) {
          for (const vid of verdictIdsForItem(item)) {
            const autoVerdict = auto.get(vid);
            const existing = prior.get(vid);
            if (existing) {
              drafts[vid] = {
                status: existing.status,
                note: existing.note ?? "",
              };
              if (autoVerdict?.status === existing.status) autoIds.add(vid);
              continue;
            }
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
  // A point excluded from scoring for the version (an erratum's `excludeFromScore`)
  // no longer counts, so grading it is optional — it must not block submission. A
  // whole-item exclusion clears the item; within a category, only the excluded
  // sub-items are exempt while the rest still require a verdict.
  const itemAddressed = (item: ReviewItem) => {
    if (item.scored === false) return true;
    const subs = item.subItems ?? [];
    if (subs.length === 0) return Boolean(verdicts[item.id]?.status);
    return subs.every(
      (sub) =>
        sub.scored === false ||
        Boolean(verdicts[subItemVerdictId(item.id, sub.id)]?.status),
    );
  };
  const allAddressed = items.every(itemAddressed);
  // A jam is fully rated once the whole-game overall grade is picked (it has no
  // domains); a domain-scored case once every domain carries a rating.
  const allRated = jam
    ? overall !== ""
    : domains.every((domain) => ratings[domain.id]);

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

  // Put the given verdicts back to what this run's validation decided, undoing the
  // reviewer's overrides. The machine's calls live in the immutable run record, not
  // in the review, so they stay recoverable however many edits later — this is the
  // only way back once an override has been submitted, since a stored verdict keeps
  // no memory of having been auto-set.
  //
  // Only the pass/fail is restored: validation writes no note, so a note is the
  // reviewer's own prose and is left for them to clear (or keep, where it still
  // explains the point). Each restored verdict re-joins the auto-set group and so
  // reads desaturated again.
  function restoreAutoVerdicts(ids: string[]) {
    if (ids.length === 0) return;
    setVerdicts((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const decided = auto.get(id);
        if (!decided) continue;
        next[id] = { status: decided.status, note: prev[id]?.note ?? "" };
      }
      return next;
    });
    setAutoVerdictIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) if (auto.has(id)) next.add(id);
      return next;
    });
  }

  // The declared points whose answer currently differs from what validation decided
  // — the reviewer's overrides. Drives both the per-verdict Restore control and the
  // rail's bulk restore, so the two never disagree about what there is to undo.
  const overriddenIds = useMemo(
    () => overriddenAutoVerdictIds(items, auto, verdicts),
    [items, auto, verdicts],
  );
  const overriddenSet = useMemo(() => new Set(overriddenIds), [overriddenIds]);

  // Restore every overridden point at once, from the rail. Confirmed first because
  // it discards the reviewer's own calls wholesale — the mirror image of "Mark
  // unplayable", which overwrites them wholesale.
  function restoreAllAutoVerdicts() {
    const n = overriddenIds.length;
    if (n === 0) return;
    if (
      !window.confirm(
        `Restore ${n} overridden ${n === 1 ? "verdict" : "verdicts"} to what this run's automated validation decided? Your own Pass/Fail on ${n === 1 ? "that point" : "those points"} will be discarded; notes are kept.`,
      )
    )
      return;
    restoreAutoVerdicts(overriddenIds);
  }

  // The pass/fail control (and its optional note) for one gradable unit, keyed by
  // its verdict id — the item's own id, or a `<item>.<sub>` composite for a
  // sub-item. Shared so a whole-item verdict and each sub-item's verdict use the
  // identical radiogroup: Pass/Fail as two radio-like buttons, a roving tabindex +
  // arrow keys, and clicking the selected option clearing it back to unset.
  function renderVerdict(verdictId: string, disabled = false) {
    const d = verdicts[verdictId] ?? { status: "", note: "" };
    // Whether this verdict is still holding its pre-filled auto value (the reviewer
    // has not overridden it). Its selected option renders desaturated to mark it as
    // machine-set rather than reviewer-set.
    const isAuto = autoVerdictIds.has(verdictId);
    // The automated-validation media backing exactly this verdict (the reference
    // baseline beside this run's actual), so the reviewer can visually verify the
    // point — for a sub-item, its own proof rather than a shared item-level clip.
    const media = validationByVerdict.get(verdictId) ?? [];
    // The mechanical assertions the debug script checked to reach this verdict —
    // each fact with its own detail, both the parts that held and any that failed —
    // so the reviewer sees precisely what backs the auto pass/fail.
    const assertions = assertionsByVerdict.get(verdictId) ?? [];
    return (
      <>
        {media.map((m) => (
          <ValidationMediaPair key={m.id} media={m} />
        ))}
        {assertions.length > 0 && (
          <ul className={styles.assertionList}>
            {assertions.map((a, i) => (
              <li key={i} className={styles.assertion}>
                <span
                  className={
                    a.pass ? styles.assertionPass : styles.assertionFail
                  }
                  role="img"
                  aria-label={a.pass ? "Passed" : "Failed"}
                >
                  {a.pass ? "✓" : "✗"}
                </span>
                <span className={styles.assertionBody}>
                  <span>{a.label}</span>
                  {/* A failing comparison shows what it required against what it
                      observed; a passing check (or a bare boolean fact) is just its
                      label — there is nothing to reconcile. */}
                  {!a.pass && (a.expected != null || a.actual != null) && (
                    <span className={styles.assertionMismatch}>
                      {a.expected != null && (
                        <span>
                          <span className={styles.assertionMismatchKey}>
                            Expected
                          </span>{" "}
                          {a.expected}
                        </span>
                      )}
                      {a.actual != null && (
                        <span>
                          <span className={styles.assertionMismatchKey}>
                            Actual
                          </span>{" "}
                          {a.actual}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
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
                  disabled={disabled}
                  tabIndex={
                    disabled ? -1 : selected || (!d.status && i === 0) ? 0 : -1
                  }
                  className={`${styles.verdictOption} ${
                    s === "pass"
                      ? styles.verdictOptionPass
                      : styles.verdictOptionFail
                  }${selected ? ` ${styles.verdictOptionActive}` : ""}${
                    selected && isAuto ? ` ${styles.verdictOptionAuto}` : ""
                  }`}
                  title={
                    disabled
                      ? "Excluded from scoring by an erratum — not rated"
                      : selected && isAuto
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
            disabled={disabled}
          />
          {/* Offered only where the reviewer's answer differs from a verdict
              validation actually decided — so it never appears as a no-op, and
              never on a point the machine left to human judgement. */}
          {!disabled && overriddenSet.has(verdictId) && (
            <button
              type="button"
              className={styles.verdictRestore}
              onClick={() => restoreAutoVerdicts([verdictId])}
              title={`Restore this verdict to ${VERDICT_META[auto.get(verdictId)!.status].label} — what this run's debug script decided. Your note is kept.`}
              aria-label="Restore this verdict to the automated validation's result"
            >
              Restore
            </button>
          )}
        </div>
      </>
    );
  }

  // The graded (game-jam) counterpart of {@link renderVerdict}: the five-emoji
  // grade picker plus the same optional note, keyed by the item's verdict id.
  function renderGradeVerdict(verdictId: string, disabled = false) {
    const d = verdicts[verdictId] ?? { status: "", note: "" };
    return (
      <div className={styles.checklistControls}>
        <GradeChoice
          value={isGrade(d.status) ? d.status : ""}
          onChange={(next) => setVerdict(verdictId, { status: next })}
          ariaLabel="Grade"
          disabled={disabled}
        />
        <input
          className={styles.input}
          value={d.note}
          onChange={(e) => setVerdict(verdictId, { note: e.target.value })}
          placeholder="note (optional)"
          disabled={disabled}
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
      verdictIdsForItem(item).flatMap((vid) => {
        const draft = verdicts[vid] ?? { status: "", note: "" };
        // Omit an unrated point rather than sending an empty status the backend's
        // `VerdictStatus` enum would reject (422). With the completeness gate this
        // only arises for a point excluded from scoring (an erratum's
        // `excludeFromScore`) that the reviewer chose to skip — it simply carries no
        // verdict, exactly as it carries no score.
        if (!draft.status) return [];
        const note = draft.note.trim();
        return [
          {
            id: vid,
            status: draft.status,
            ...(note ? { note } : {}),
          },
        ];
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
      // Only carried when revising an existing review; the backend ignores it on a
      // first submission and requires it on a content-changing edit.
      editNote: ownReview ? editNote.trim() : undefined,
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
  const onSubmitReview = () => {
    // Editing a submitted review requires a note explaining the change; catch it
    // client-side for an immediate message rather than a round-trip rejection.
    if (ownReview && !editNote.trim()) {
      setError(
        "Editing a submitted review requires a note explaining what changed.",
      );
      return;
    }
    runAction(ownReview ? "Review updated." : "Review submitted.", async () => {
      await client!.submitReview(runId, buildReview(), token!);
      setSubmittedThisSession(true);
      setEditNote("");
      // Collapse back to the summary; the just-submitted review now shows there.
      setEditing(false);
    });
  };

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
      // Only a terminal success retires the action: a publish that did not
      // complete must stay retryable.
      if (result.published) setPublishedThisSession(true);
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
  // A run published this session (the enqueued publish reported success) reads as
  // published straight away, without waiting for the detail record to be refetched
  // — so the action disappears the moment it succeeds rather than lingering as a
  // second, doomed Publish.
  const isPublished = published || publishedThisSession;

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

  // The flat list of gradable "slots" — one per review item, so the panel shows a
  // single review item at a time rather than a whole category at once (which stacked
  // every point's proof media on screen together). A category of review items
  // contributes one slot per item; a graded (jam) category or a legacy leaf item (no
  // sub-items) contributes a single whole-item slot. `current` indexes this list; the
  // rail stays an accordion grouped by category.
  const slots = useMemo(() => {
    const out: { itemIndex: number; subIndex: number }[] = [];
    items.forEach((it, itemIndex) => {
      const subs = it.graded ? [] : (it.subItems ?? []);
      if (subs.length > 0)
        subs.forEach((_, subIndex) => out.push({ itemIndex, subIndex }));
      else out.push({ itemIndex, subIndex: -1 });
    });
    return out;
  }, [items]);
  // Clamp `current` to the slot list as items load or change.
  const slotIndex = slots.length > 0 ? Math.min(current, slots.length - 1) : 0;
  const slot = slots[slotIndex];
  const item = slot ? items[slot.itemIndex] : undefined;
  const sub =
    slot && slot.subIndex >= 0 ? item?.subItems?.[slot.subIndex] : undefined;
  // Whether the current point is excluded from scoring for the version (an erratum's
  // `excludeFromScore`): a whole-item exclusion clears the item, a sub-item one just
  // that sub. Shown as a "not scored" badge in place of the point value.
  const slotNotScored =
    item?.scored === false || (sub ? sub.scored === false : false);
  // The verdict id for the current slot — the sub-item's composite, or the item's own.
  const slotVerdictId = item
    ? sub
      ? subItemVerdictId(item.id, sub.id)
      : item.id
    : "";
  // The slot index of a category's first review item, and of a specific sub-item, so
  // the rail's category header and sub-item rows can jump to the right slot.
  const firstSlotOfItem = (itemIndex: number) =>
    slots.findIndex((s) => s.itemIndex === itemIndex);
  const slotOf = (itemIndex: number, subIndex: number) =>
    slots.findIndex(
      (s) => s.itemIndex === itemIndex && s.subIndex === subIndex,
    );
  // Whether the current slot's verdict carries automated-validation media (rendered by
  // `renderVerdict`), so the expected/submitted panes stand down in its place.
  const slotHasValidationMedia = slotVerdictId
    ? validationByVerdict.has(slotVerdictId)
    : false;
  // How many slots (review items) are addressed, for the rail's progress label — the
  // navigation is now per review item, so the count is too.
  const slotAddressed = (s: { itemIndex: number; subIndex: number }) => {
    const it = items[s.itemIndex];
    if (!it) return false;
    const subItem = s.subIndex >= 0 ? it.subItems?.[s.subIndex] : undefined;
    // An excluded point (erratum `excludeFromScore`) needs no verdict — treat it as
    // addressed so it neither drags the progress count nor traps Previous/Next on a
    // point the reviewer is free to skip.
    if (it.scored === false || subItem?.scored === false) return true;
    const vid = subItem ? subItemVerdictId(it.id, subItem.id) : it.id;
    return Boolean(verdicts[vid]?.status);
  };
  const addressedSlots = slots.filter(slotAddressed).length;
  // The nearest still-unaddressed slot before / after the current one. Previous and
  // Next jump straight to these — skipping items the reviewer has already answered —
  // and disable when nothing remains unreviewed on that side.
  let prevUnreviewed = -1;
  for (let i = slotIndex - 1; i >= 0; i--) {
    if (!slotAddressed(slots[i]!)) {
      prevUnreviewed = i;
      break;
    }
  }
  let nextUnreviewed = -1;
  for (let i = slotIndex + 1; i < slots.length; i++) {
    if (!slotAddressed(slots[i]!)) {
      nextUnreviewed = i;
      break;
    }
  }
  // The live score from the current effective verdicts (auto pre-fills plus any
  // overrides), so the reviewer sees the running total before submitting. Mirrors
  // how the published verdict scores its checklist.
  const liveScore =
    items.length > 0 ? scoreChecklist(items, buildChecklist()) : null;
  // How many of this run's declared debug scripts actually ran to completion
  // against a conformant build (the debug-API gate). A shortfall — most visibly
  // zero, e.g. when the run built against a stale service image — means the
  // automated checks did not grade this run; the live-score bar surfaces the ratio
  // so that is never silent.
  const ranChecks = debugScripts.filter((s) => s.ran).length;

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
          the form the reviewer is here to complete. Show it only once *this* reviewer
          has submitted their own review, where it stands as evidence behind their
          verdict — another reviewer's review must not reveal it early. Even then it
          stays folded away: by that point the reviewer has already made the call, so
          an expanded table here is a screenful of scrolling between them and the
          review summary and actions below. */}
      {debugScripts.length > 0 && (ownReview || submittedThisSession) && (
        <DebugScriptList
          scripts={debugScripts}
          heading="Automated validation"
          collapsible
        />
      )}

      {/* The review form proper — the checklist questions, the writeup, and the
          per-domain ratings — shown only while writing or revising a review. */}
      {showForm && (
        <>
          {/* The live, auto-calculated score from the current effective verdicts.
              Auto verdicts pre-fill the checklist, so this reflects a running total
              before the reviewer submits; overriding a verdict updates it live. When
              the case declares automated validation, the bar also reports how many of
              its debug scripts ran (right-aligned) and expands to the per-script
              pass/fail breakdown — so a build where the checks never ran (e.g. a stale
              service image left the scripts ungraded) shows a plain "0 / N checks ran"
              rather than looking silently unscored. A game jam scores the same way —
              each graded category is worth `weight × 10` and earns its tier's points
              — so it gets the same running total; it simply never declares automated
              validation, so it always takes the plain branch. */}
          {liveScore && (
            <div className={styles.notice}>
              {debugScripts.length > 0 ? (
                <>
                  <button
                    type="button"
                    className={styles.liveScoreBar}
                    onClick={() => setChecksExpanded((open) => !open)}
                    aria-expanded={checksExpanded}
                  >
                    <span className={styles.liveScoreSummary}>
                      Live score:{" "}
                      <strong>
                        {formatPoints(liveScore.earned)} / {liveScore.total} pts
                      </strong>
                    </span>
                    <span className={styles.liveScoreChecks}>
                      <span
                        className={
                          ranChecks < debugScripts.length
                            ? styles.liveScoreChecksShort
                            : undefined
                        }
                      >
                        {ranChecks} / {debugScripts.length} check
                        {debugScripts.length === 1 ? "" : "s"} ran
                      </span>
                      <span
                        className={styles.liveScoreChevron}
                        aria-hidden="true"
                      >
                        {checksExpanded ? "▾" : "▸"}
                      </span>
                    </span>
                  </button>
                  {/* The per-script pass/fail breakdown — the same list the Verdict
                      tab shows once a review is submitted — revealed on expand with
                      the accordion's height/opacity tween. Kept mounted and marked
                      `inert` while collapsed so its controls stay out of the tab
                      order and a11y tree. */}
                  <div
                    className={`${styles.liveScoreReveal}${
                      checksExpanded ? ` ${styles.liveScoreRevealOpen}` : ""
                    }`}
                    inert={!checksExpanded}
                  >
                    <div className={styles.liveScoreClip}>
                      <DebugScriptList scripts={debugScripts} />
                    </div>
                  </div>
                </>
              ) : (
                <span>
                  Live score:{" "}
                  <strong>
                    {formatPoints(liveScore.earned)} / {liveScore.total} pts
                  </strong>
                </span>
              )}
            </div>
          )}

          {item && (
            <div className={styles.reviewLayout}>
              {/* The navigable rail of every checklist item; answered items are
              marked done, the current one highlighted. */}
              <nav className={styles.itemRail} aria-label="Checklist items">
                <p className={styles.sectionLabel}>
                  {addressedSlots}/{slots.length} addressed
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
                {/* Put every overridden point back to the machine's call. Shown
                    only for a run that carries automated verdicts at all, and
                    inert until at least one is overridden — so it reads as the
                    undo it is rather than a mystery control. */}
                {auto.size > 0 && (
                  <button
                    type="button"
                    className={styles.restoreAuto}
                    onClick={restoreAllAutoVerdicts}
                    disabled={busy || overriddenIds.length === 0}
                    title={
                      overriddenIds.length === 0
                        ? "Every automatically-decided verdict already matches this run's validation"
                        : `Discard your Pass/Fail on ${overriddenIds.length} overridden ${
                            overriddenIds.length === 1 ? "point" : "points"
                          } and restore what this run's validation decided`
                    }
                  >
                    Restore validator verdicts
                    {overriddenIds.length > 0
                      ? ` (${overriddenIds.length})`
                      : ""}
                  </button>
                )}
                {/* An accordion of categories. Each category is a header row; the
                one holding the current review item expands to list its items, and
                selecting an item shows that item — one at a time — in the panel. A
                graded (jam) category or a legacy leaf item (no sub-items) is a header
                row that is itself the selectable point. */}
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
                    // The category holding the current review item is the active one.
                    const isCurrent = slot?.itemIndex === index;
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
                          onClick={() => setCurrent(firstSlotOfItem(index))}
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
                        {/* The sub-item list stays mounted so it can animate its
                        height open/closed (grid 0fr→1fr) rather than snapping in;
                        while collapsed it is `inert` so its buttons stay out of the
                        tab order and a11y tree. */}
                        {subItems.length > 0 && (
                          <div
                            className={`${styles.subNavReveal}${
                              expanded ? ` ${styles.subNavRevealOpen}` : ""
                            }`}
                            inert={!expanded}
                          >
                            <div className={styles.subNavClip}>
                              <ol className={styles.subNavList}>
                                {subItems.map((subItem, si) => {
                                  const st =
                                    verdicts[
                                      subItemVerdictId(it.id, subItem.id)
                                    ]?.status ?? "";
                                  const subMark = !st
                                    ? `${String.fromCharCode(97 + si)}.`
                                    : st === "fail"
                                      ? "✕"
                                      : "✓";
                                  const subActive =
                                    slot?.itemIndex === index &&
                                    slot?.subIndex === si;
                                  return (
                                    <li key={subItem.id}>
                                      <button
                                        type="button"
                                        className={`${styles.subNav}${
                                          subActive
                                            ? ` ${styles.subNavActive}`
                                            : ""
                                        }${st ? ` ${styles.subNavDone}` : ""}${
                                          st === "fail"
                                            ? ` ${styles.subNavFail}`
                                            : ""
                                        }`}
                                        onClick={() =>
                                          setCurrent(slotOf(index, si))
                                        }
                                        aria-current={
                                          subActive ? "true" : undefined
                                        }
                                      >
                                        <span
                                          className={styles.subNavMark}
                                          aria-hidden="true"
                                        >
                                          {subMark}
                                        </span>
                                        <span className={styles.subNavTitle}>
                                          {subItem.title}
                                        </span>
                                      </button>
                                    </li>
                                  );
                                })}
                              </ol>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>

              {/* The current question: title, description, the expected vs submitted
              media (when the item pairs them), and the verdict controls. */}
              <div className={styles.questionPanel}>
                {/* The category the current review item belongs to, as an eyebrow, so
                the reviewer keeps their place while seeing one point at a time. */}
                {sub && (
                  <span className={styles.checklistCategory}>{item.title}</span>
                )}
                <span className={styles.checklistTitle}>
                  <span className={styles.checklistNumber}>
                    {slotIndex + 1}.
                  </span>{" "}
                  {sub ? sub.title : item.title}{" "}
                  {slotNotScored ? (
                    <span className={styles.notScored}>Not scored</span>
                  ) : (
                    <>
                      (
                      {sub
                        ? formatPoints(sub.weight ?? 1)
                        : itemPoints(item, verdicts[item.id]?.status)}
                      )
                    </>
                  )}
                </span>
                {/* The point's prose: a sub-item's own description, or a whole item's
                text (a category itself carries none). */}
                {sub
                  ? sub.description && (
                      <span className={styles.checklistText}>
                        {sub.description}
                      </span>
                    )
                  : item.text && (
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

                {/* Expected reference beside submitted proof for this one point. Each
                pane shows only when that side exists — a point may declare just a
                proof — and it stands down entirely for a point whose automated
                actual-vs-baseline pair (rendered by `renderVerdict`) takes its place. */}
                {!slotHasValidationMedia &&
                  mediaPanesFor(
                    sub ? sub.reference : item.reference,
                    sub ? sub.proof : item.proof,
                  )}

                {/* Record the verdict for this one point: a game-jam category is graded
                on the five-emoji scale; every other point is Pass/Fail. The
                automated-validation media backing the point renders at the top of the
                verdict control. */}
                {item.graded
                  ? renderGradeVerdict(item.id, slotNotScored)
                  : renderVerdict(slotVerdictId, slotNotScored)}

                {/* Previous / Next jump to the nearest unreviewed item on that side
                and disable when none remains — the wrapper carries the explanatory
                tooltip because a disabled button receives no pointer events, so a
                native `title` would never show. */}
                <div className={styles.questionNav}>
                  <span
                    className={styles.navButton}
                    data-tooltip={
                      prevUnreviewed < 0
                        ? "No earlier unreviewed items"
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() =>
                        prevUnreviewed >= 0 && setCurrent(prevUnreviewed)
                      }
                      disabled={prevUnreviewed < 0}
                    >
                      ← Previous
                    </button>
                  </span>
                  <span
                    className={styles.navButton}
                    data-tooltip={
                      nextUnreviewed < 0
                        ? "No further unreviewed items"
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() =>
                        nextUnreviewed >= 0 && setCurrent(nextUnreviewed)
                      }
                      disabled={nextUnreviewed < 0}
                    >
                      Next →
                    </button>
                  </span>
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

          {/* Editing a submitted review requires an explanation of what changed —
              recorded (with an autogenerated diff) in the review's public edit
              history. Shown only when revising an existing review. */}
          {ownReview && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>What changed?</span>
              <textarea
                className={styles.textarea}
                rows={2}
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="Briefly explain what you changed and why — required, and saved to this review's edit history."
              />
            </label>
          )}

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
        // Who is reviewing, shown left of the action buttons (in place of the
        // former standalone "Reviewing as …" bar): the signed-in account's avatar
        // and name, or a sign-in prompt while logged out. Rendered only with the
        // form open (the read-only published view has no actions row).
        const reviewingAs = showForm ? (
          <div className={styles.reviewingAs}>
            {account ? (
              <>
                <Avatar
                  name={account.displayName}
                  pictureUrl={account.pictureUrl}
                  size={22}
                />
                <span>
                  Reviewing as <strong>{account.displayName}</strong>
                </span>
              </>
            ) : (
              <span className={styles.reviewingAsWarn}>
                <Link to={routes.login(routes.runDetail(runId))}>Sign in</Link>{" "}
                to review and publish this run.
              </span>
            )}
          </div>
        ) : null;
        // The solo desktop path offers a single Publish that saves the review and
        // publishes in one step. The web flow splits into submit review and publish
        // (the latter gated on the run having a review). A produced run's record is
        // already stored on the backend (the driver pushes it on completion), so
        // neither flow has a separate push step. The reviewer identity is left-aligned;
        // the buttons are pushed to the right of the row.
        //
        // An ALREADY-PUBLISHED run offers no Publish action on either path — it is
        // public, the backend refuses a second publish, and a revised review
        // refreshes the public snapshot by itself. What remains is the review
        // control: the solo path, which has no separate submit button, gets the
        // web flow's "Update review" so a desktop reviewer can still correct a
        // published review. Every type behaves the same here — a game jam runs the
        // identical submit -> publish lifecycle a test run does.
        const submitButton = (
          <button
            className={isPublished ? styles.primary : styles.secondary}
            onClick={onSubmitReview}
            disabled={busy || needAccount || !reviewReady}
            title={needAccount ? "Sign in to review" : reviewTitle}
          >
            {ownReview ? "Update review" : "Submit review"}
          </button>
        );
        if (solo && !isPublished) {
          return (
            <div className={styles.actions}>
              {reviewingAs}
              <div className={styles.actionsEnd}>
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
            </div>
          );
        }
        const publishButton = isPublished ? null : (
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
        );
        // With the form collapsed on a published run there is nothing left to
        // offer — no submit, no publish, nothing to cancel — so the row is dropped
        // rather than left as an empty band of padding.
        if (!showForm && !publishButton && !cancelButton) return null;
        return (
          <div className={styles.actions}>
            {reviewingAs}
            <div className={styles.actionsEnd}>
              {showForm && submitButton}
              {publishButton}
              {cancelButton}
            </div>
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
// outputs the pair shares one Play/Pause control, sat in the output's title row:
// Play restarts both clips from the top and plays them together (so the reference and
// the run advance frame-for-frame), Pause stops both, and the clips loop so the
// comparison keeps repeating. The two clips are muted so playing them together is not
// a cacophony.
function ValidationMediaPair({ media }: { media: ValidationMedia }) {
  const isVideo = media.kind === "video";
  const actualRef = useRef<HTMLVideoElement>(null);
  const baselineRef = useRef<HTMLVideoElement>(null);
  const hasBaseline = media.baselineUrl !== null;
  const hasActual = media.actualUrl !== null;
  const [playing, setPlaying] = useState(false);

  // Restart both clips from the top and play them together; clicking Play again
  // restarts. Pause stops both where they are.
  const play = () => {
    for (const ref of [baselineRef, actualRef]) {
      const el = ref.current;
      if (el) {
        el.currentTime = 0;
        void el.play();
      }
    }
  };
  const pause = () => {
    for (const ref of [baselineRef, actualRef]) ref.current?.pause();
  };

  // Keep the toggle label in step with the clips even when the reviewer scrubs with
  // the native controls: mirror the primary clip's play/pause events. Both clips are
  // driven together, so tracking one is enough. (Looping never fires `pause`, so the
  // label stays "Pause" across loops.)
  useEffect(() => {
    const el = (hasActual ? actualRef : baselineRef).current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [hasActual]);

  // When the reviewer moves to another review item this pair is reused for that
  // item's media (its output ids can collide with the previous item's, so React
  // reconciles the same element rather than remounting): the video elements get new
  // sources and stop, but swapping a `src` fires no `pause` event for the label-sync
  // effect above to catch, leaving the toggle stuck on "Pause" over a stopped clip.
  // Reset the label whenever the media changes so it always matches what is shown.
  useEffect(() => {
    setPlaying(false);
  }, [media.actualUrl, media.baselineUrl]);

  return (
    <figure className={styles.validationOutput}>
      <figcaption className={styles.validationOutputHeader}>
        <span className={styles.validationOutputName}>{media.name}</span>
        {isVideo && (hasActual || hasBaseline) && (
          <button
            type="button"
            className={styles.validationPlay}
            onClick={playing ? pause : play}
            aria-pressed={playing}
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
        )}
      </figcaption>
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
              loop
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
              loop
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
