import { useMemo, useState } from "react";
import type {
  Assertion,
  DebugScriptResult,
  Inconclusive,
  RunRecord,
} from "@test-cabinet/run-record";
import type { ProofMedia, ReferenceShot } from "../../../../client/types";
import {
  useGalleryData,
  type ValidationMedia,
} from "../../../data/galleryContext";
import { useRunVariant } from "../../../data/useRunVariant";
import type { ReviewItemSummary } from "../../../data/testCases";
import {
  FAILURE_CAP_META,
  VERDICT_META,
  automatedVerdicts,
  effectiveVerdicts,
  formatPoints,
  subItemVerdictId,
  verdictIdsForItem,
  type VerdictStatus,
} from "../../../data/ratings";
import { MediaView } from "../../../components/MediaView";
import { ReviewItemAssets } from "./AssetResultSection";
import { ValidationReplayPair } from "./ValidationReplayPair";
import { ValidationMediaPair } from "./ValidationMediaPair";
import type { ValidatorReviewInput } from "./ValidatorVerdict";
import styles from "../RunExec.module.scss";

/** What a point left undecided says, per reason the validators gave. A record
 * written before the reasons were told apart carries none, and reads as the
 * unmet precondition that was then the only thing this state meant. */
const INCONCLUSIVE_NOTE: Record<Inconclusive, string> = {
  preconditionUnmet:
    "The validator's precondition was not met, so it left this point undecided.",
  notRun:
    "The validator could not be run against this build, so it left this point undecided.",
  timedOut:
    "The validators ran out of time on the machine that scored this run, so they left this point undecided. Nothing here is a judgement of the build.",
};

/** Format a point weight as `1 pt` / `2 pts`. */
function pts(weight: number): string {
  return `${weight} ${weight === 1 ? "pt" : "pts"}`;
}

/** The affected domains of a failing point as prose: "Single player", "Single
 * player and Versus", "A, B, and C". Ids fall back where no name is known. */
function formatDomainNames(
  ids: readonly string[],
  nameById: ReadonlyMap<string, string>,
): string {
  const names = ids.map((id) => nameById.get(id) ?? id);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

// The read-only per-item browser over a run's automated review items — the
// **single per-item surface** of a validator-rated run's Verdict tab: the same
// navigable rail + one-question-at-a-time panel the review editor walks a
// checklist with, but **browsing only** — no verdict radiogroups, no notes, no
// restore controls. Each point shows its prose, the assets it names, the
// expected-vs-submitted media it pairs, the automated-validation media backing
// its verdict (the reference implementation beside this run's build), the
// mechanical assertions the debug script checked, the failure cap and affected
// domains of a failing scored point, the backing validator script (its detail,
// path, and ran / did-not-run / inconclusive state), and the effective
// verdict readout — the validators' call, or a reviewer's override where one
// exists, marked as such.
//
// Mounted wherever a **validator-rated** run's verdict is read rather than
// written: the Verdict tab's read-only panel (the public gallery included) —
// so anyone can browse what the machine checked and compare the run against
// the reference, whether or not they can review.
export function ReviewItemBrowser({
  run,
  items,
  domains = [],
  reviews = [],
}: {
  run: RunRecord;
  /** The effective review items to browse — the caller's already-resolved
   * checklist (the editor's loaded items, or the verdict panel's scoring
   * model), so the browser can never disagree with the surface it sits on. */
  items: readonly ReviewItemSummary[];
  /** The effective scoring domains, so a failing point's cap line can name the
   * domains it affects. Ids fall back where a name is unavailable. */
  domains?: readonly { id: string; name: string }[];
  /** The run's reviews, whose checklists are reviewer overrides: the readout
   * shows each point's effective verdict and marks overridden points. Empty
   * shows the validators' verdicts alone. */
  reviews?: readonly ValidatorReviewInput[];
}) {
  const gallery = useGalleryData();
  // The run's own catalog variant, for the expected reference media (by view)
  // shown beside an item that declares a pairing. Shares the catalog cache with
  // the surrounding verdict surfaces, so this costs no extra fetch.
  const { variant } = useRunVariant(run.subject);
  const [current, setCurrent] = useState(0);

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
  // beside the question. Null for a non-asset run.
  const asset = useMemo(() => gallery.assetResultFor(run), [gallery, run]);

  // The validators' verdicts, keyed by verdict id — the same failure semantics
  // the validator rating uses, so the readout here can never disagree with it.
  const autoById = useMemo(() => {
    const map = new Map<string, VerdictStatus>();
    for (const v of automatedVerdicts(run.validation.debugScripts ?? [])) {
      map.set(v.id, v.status);
    }
    return map;
  }, [run]);

  // The EFFECTIVE verdicts: the validators' overlaid with every review's
  // overrides (each review's checklist wins per id over what came before). With
  // no reviews this is exactly the validators' set. The rail marks, the passed
  // tally, and the per-point readout all read from here, with `autoById` kept
  // beside it so an overridden point can say what the validators decided.
  const verdictById = useMemo(() => {
    let verdicts = automatedVerdicts(run.validation.debugScripts ?? []);
    for (const review of reviews) {
      verdicts = effectiveVerdicts(verdicts, review.checklist ?? []);
    }
    const map = new Map<string, VerdictStatus>();
    for (const v of verdicts) map.set(v.id, v.status);
    return map;
  }, [run, reviews]);

  // Domain id → display name, for the failure-cap line of a failing point.
  const domainNameById = useMemo(
    () => new Map(domains.map((d) => [d.id, d.name])),
    [domains],
  );

  // The validator script backing each verdict id: the script whose own unit id
  // matches, or the one whose verdicts decided it — so a point can show the
  // script's detail, path, and ran / did-not-run / inconclusive state.
  const scriptByVerdict = useMemo(() => {
    const map = new Map<string, DebugScriptResult>();
    for (const script of run.validation.debugScripts ?? []) {
      const unitId =
        script.subItemId != null
          ? subItemVerdictId(script.itemId, script.subItemId)
          : script.itemId;
      if (!map.has(unitId)) map.set(unitId, script);
      for (const v of script.verdicts) {
        if (!map.has(v.id)) map.set(v.id, script);
      }
    }
    return map;
  }, [run]);

  // The run's automated-validation media (actual build vs reference baseline),
  // grouped by the verdict id each output backs, so each item can show the
  // pair(s) that validate it side by side.
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
  // individual mechanical facts it checked, each pass or fail with its own
  // detail — keyed by the verdict id they back.
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

  // The flat list of browsable slots — one per review item, exactly as the
  // editor walks them: a category contributes one slot per sub-item, a leaf item
  // a single whole-item slot.
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

  if (slots.length === 0) return null;

  const slotIndex = Math.min(current, slots.length - 1);
  const slot = slots[slotIndex]!;
  const item = items[slot.itemIndex]!;
  const sub = slot.subIndex >= 0 ? item.subItems?.[slot.subIndex] : undefined;
  // Whether the current point is excluded from scoring for the version (an
  // erratum's `excludeFromScore`), shown as a "not scored" badge like the editor.
  const slotNotScored =
    item.scored === false || (sub ? sub.scored === false : false);
  const slotVerdictId = sub ? subItemVerdictId(item.id, sub.id) : item.id;
  const slotStatus = verdictById.get(slotVerdictId);
  const firstSlotOfItem = (itemIndex: number) =>
    slots.findIndex((s) => s.itemIndex === itemIndex);
  const slotOf = (itemIndex: number, subIndex: number) =>
    slots.findIndex(
      (s) => s.itemIndex === itemIndex && s.subIndex === subIndex,
    );
  const slotHasValidationMedia = validationByVerdict.has(slotVerdictId);
  const media = validationByVerdict.get(slotVerdictId) ?? [];
  const assertions = assertionsByVerdict.get(slotVerdictId) ?? [];
  // What the validators decided for this point, beside the effective verdict —
  // when the two differ, a reviewer overrode it (or decided a point the
  // validators left undecided) and the readout says so.
  const slotAuto = autoById.get(slotVerdictId);
  const slotOverridden = slotStatus != null && slotAuto !== slotStatus;
  // The failure cap + affected domains of a failing scored point — the detail
  // the Domains strip no longer carries, shown on the point itself.
  const slotCap = sub ? sub.failureCap : item.failureCap;
  const slotCapDomains = (sub ? sub.domains : item.domains) ?? [];
  const slotFailing =
    slotStatus === "fail" && !slotNotScored && slotCap != null;
  // The validator script backing this point, for its detail, path, and state.
  const slotScript = scriptByVerdict.get(slotVerdictId);
  // How many points hold an effective pass, for the rail's summary label — a
  // read-only browser has nothing "addressed", only what was decided.
  const passedSlots = slots.filter((s) => {
    const it = items[s.itemIndex]!;
    const si = s.subIndex >= 0 ? it.subItems?.[s.subIndex] : undefined;
    const vid = si ? subItemVerdictId(it.id, si.id) : it.id;
    return verdictById.get(vid) === "pass";
  }).length;

  // Expected reference beside submitted proof for one point (the same pairing
  // the editor shows). Each pane shows only when that side exists; null when the
  // point declares neither.
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
    <div className={styles.reviewLayout}>
      {/* The navigable rail of every checklist item, marked with the validators'
          verdicts — the same accordion the editor's rail uses, minus its
          controls (nothing here is editable). */}
      <nav className={styles.itemRail} aria-label="Checked points">
        <p className={styles.sectionLabel}>
          {passedSlots}/{slots.length} passed
        </p>
        <ol className={styles.itemNavList}>
          {items.map((it, index) => {
            // Aggregate the item's verdict ids into a single rail mark: all
            // decided and all passing shows a check, any fail shows a cross,
            // otherwise (a point validation left undecided) the item's number.
            const statuses = verdictIdsForItem(it).map((vid) =>
              verdictById.get(vid),
            );
            const decided = statuses.every(Boolean);
            const anyFail = statuses.some((s) => s === "fail");
            const isCurrent = slot.itemIndex === index;
            const mark = !decided ? index + 1 : anyFail ? "✕" : "✓";
            const title = !decided
              ? undefined
              : `${it.title}: ${anyFail ? "some Fail" : "all Pass"}`;
            const subItems = it.graded ? [] : (it.subItems ?? []);
            const expanded = isCurrent && subItems.length > 0;
            return (
              <li key={it.id}>
                <button
                  type="button"
                  className={`${styles.itemNav}${
                    isCurrent ? ` ${styles.itemNavActive}` : ""
                  }${decided ? ` ${styles.itemNavDone}` : ""}${
                    decided && anyFail ? ` ${styles.itemNavFail}` : ""
                  }`}
                  onClick={() => setCurrent(firstSlotOfItem(index))}
                  aria-current={isCurrent ? "true" : undefined}
                  aria-expanded={subItems.length > 0 ? expanded : undefined}
                  title={title}
                >
                  <span className={styles.itemNavMark} aria-hidden="true">
                    {mark}
                  </span>
                  <span className={styles.itemNavTitle}>
                    {it.title} ({pts(it.weight)})
                  </span>
                </button>
                {/* The sub-item list stays mounted so it can animate open/closed;
                    while collapsed it is `inert` so its buttons stay out of the
                    tab order and a11y tree — exactly the editor's rail. */}
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
                          const st = verdictById.get(
                            subItemVerdictId(it.id, subItem.id),
                          );
                          const subMark = !st
                            ? `${String.fromCharCode(97 + si)}.`
                            : st === "fail"
                              ? "✕"
                              : "✓";
                          const subActive =
                            slot.itemIndex === index && slot.subIndex === si;
                          return (
                            <li key={subItem.id}>
                              <button
                                type="button"
                                className={`${styles.subNav}${
                                  subActive ? ` ${styles.subNavActive}` : ""
                                }${st ? ` ${styles.subNavDone}` : ""}${
                                  st === "fail" ? ` ${styles.subNavFail}` : ""
                                }`}
                                onClick={() => setCurrent(slotOf(index, si))}
                                aria-current={subActive ? "true" : undefined}
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

      {/* The current point: title, prose, the media that back it, the assertions
          the script checked, and the validators' Pass/Fail — nothing editable. */}
      <div className={styles.questionPanel}>
        {sub && <span className={styles.checklistCategory}>{item.title}</span>}
        <span className={styles.checklistTitle}>
          <span className={styles.checklistNumber}>{slotIndex + 1}.</span>{" "}
          {sub ? sub.title : item.title}{" "}
          {slotNotScored ? (
            <span className={styles.notScored}>Not scored</span>
          ) : (
            <>({sub ? formatPoints(sub.weight ?? 1) : pts(item.weight)})</>
          )}
        </span>
        {sub
          ? sub.description && (
              <span className={styles.checklistText}>{sub.description}</span>
            )
          : item.text && (
              <span className={styles.checklistText}>{item.text}</span>
            )}

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

        {/* Expected reference beside submitted proof, standing down for a point
            whose automated actual-vs-baseline pair below takes its place. */}
        {!slotHasValidationMedia &&
          mediaPanesFor(
            sub ? sub.reference : item.reference,
            sub ? sub.proof : item.proof,
          )}

        {/* The automated-validation media backing exactly this point: the
            reference implementation beside this run's build. An engine replay is
            a different pairing from an image or a clip (its panes share one
            clock), so it is dispatched here; the keys are prefixed by kind so an
            output id reused across kinds remounts the right component. */}
        {media.map((m) =>
          m.kind === "replay" ? (
            <ValidationReplayPair key={`replay:${m.id}`} media={m} />
          ) : (
            <ValidationMediaPair key={`media:${m.id}`} media={m} />
          ),
        )}
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

        {/* The failure cap this point imposes while it fails, and the domains
            it lowers — the detail the Domains strip's cap list used to carry,
            shown on the failing point itself. */}
        {slotFailing && slotCap && (
          <p
            className={styles.capNote}
            title={FAILURE_CAP_META[slotCap].description}
          >
            Failing caps{" "}
            {formatDomainNames(slotCapDomains, domainNameById) || "its domains"}{" "}
            at {FAILURE_CAP_META[slotCap].label}.
          </p>
        )}

        {/* The validator script behind this point: its ran / did-not-run /
            inconclusive state, any failure detail, and its path — the
            information the old "Automated validation" table carried. */}
        {slotScript && (
          <div className={styles.scriptNote}>
            <p className={styles.muted}>
              {slotScript.preconditionUnmet
                ? INCONCLUSIVE_NOTE[
                    slotScript.inconclusive ?? "preconditionUnmet"
                  ]
                : slotScript.ran
                  ? "The validator script ran to completion."
                  : "The validator script did not run: a debug-API contract failure, which fails the point it backs."}
              {slotScript.detail && <> {slotScript.detail}</>}
            </p>
            <p className={styles.scriptPath}>{slotScript.script}</p>
          </div>
        )}

        {/* The effective call on this point, as a readout rather than a
            control — the validators', or a reviewer's override, marked as
            such. There is no verdict to give on a browsed run. */}
        <p className={styles.muted}>
          {slotStatus ? (
            <>
              <span
                className={
                  slotStatus === "pass"
                    ? styles.assertionPass
                    : styles.assertionFail
                }
                role="img"
                aria-label={slotStatus === "pass" ? "Passed" : "Failed"}
              >
                {slotStatus === "pass" ? "✓" : "✗"}
              </span>{" "}
              {slotOverridden ? (
                <>
                  {VERDICT_META[slotStatus].label}, overridden by a reviewer
                  {slotAuto
                    ? ` (the validators said ${VERDICT_META[slotAuto].label})`
                    : " (the validators left it undecided)"}
                  .
                </>
              ) : (
                <>
                  {VERDICT_META[slotStatus].label}, decided by this run&rsquo;s
                  validators.
                </>
              )}
            </>
          ) : (
            "Not automatically checked."
          )}
        </p>

        <div className={styles.questionNav}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => slotIndex > 0 && setCurrent(slotIndex - 1)}
            disabled={slotIndex === 0}
          >
            ← Previous
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() =>
              slotIndex < slots.length - 1 && setCurrent(slotIndex + 1)
            }
            disabled={slotIndex === slots.length - 1}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
