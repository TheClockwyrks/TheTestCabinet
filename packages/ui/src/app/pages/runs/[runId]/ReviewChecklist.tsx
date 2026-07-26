import type { ReactNode } from "react";
import {
  GRADE_META,
  GRADE_MAX_POINTS,
  VERDICT_META,
  isGrade,
  subItemVerdictId,
  type ReviewVerdict,
  type VerdictStatus,
} from "../../../data/ratings";
import type { ReviewItemSummary } from "../../../data/testCases";
import type { ReviewModel } from "../../../data/galleryContext";
import styles from "./RunDetailPages.module.scss";

// Map a verdict status to the row class that tints its marker.
const VERDICT_CLASS = {
  pass: styles.verdictPass,
  fail: styles.verdictFail,
} as const;

// The marker shown in the status gutter for an item nobody has judged — the whole
// checklist when it is rendered as a case's definition (the Reviewing tab) rather
// than a run's completed review (the Verdict tab).
const UNANSWERED = "☐";

// The status-gutter label for a point excluded from scoring (an erratum's
// `excludeFromScore`) that the reviewer left unrated: "Skip", styled like the
// Pass/Fail labels but tinted amber, so the row is acknowledged in line with its
// rated siblings while clearly reading as not considered.
const NOT_SCORED_MARK = "Skip";

// The id used to group review items that belong to no declared domain.
const GENERAL = "__general__";

// Format a point weight as `1 pt` / `2 pts`.
function pts(weight: number): string {
  return `${weight} ${weight === 1 ? "pt" : "pts"}`;
}

// One heading-plus-rows block of the checklist: a scoring domain, a scoring
// category, or (heading `null`) an unlabeled run of rows.
interface ChecklistSection {
  key: string;
  heading: string | null;
  body: ReactNode;
}

// The reviewer's per-item checklist. Shared by the run Verdict tab — which passes
// the reviewer's recorded `verdicts`, so each row shows its Pass/Fail (or
// graded-emoji) marker — and the test-case Reviewing tab, which passes none,
// rendering the blank checklist a reviewer would work through with every declared
// item and sub-item shown unanswered.
//
// How the items are grouped depends on the case's review grammar. A case that
// rolls its items up to scoring **domains** is grouped by domain (each domain a
// heading, its items — whole or sub-itemed — the rows). The categories grammar
// (`[review] format = 2`) attaches no domain to any point: its top-level items ARE
// the scoring **categories**, so each category's title heads its own points rather
// than piling every category under one synthetic "General" bucket.
//
// The scoring model (item weights + domains) comes from the catalog. When it is
// unavailable (a run reviewed against a case this host lacks) the grouped view is
// empty and, in verdict mode only, the reviewer's raw verdicts are listed flat.
export function ReviewChecklist({
  model,
  verdicts,
}: {
  model: ReviewModel;
  /** The reviewer's recorded verdicts, in frontmatter order. Omitted for the
   * read-only checklist *definition* (the Reviewing tab), which renders every
   * declared item unanswered. */
  verdicts?: ReviewVerdict[];
}) {
  // No `verdicts` at all means we are rendering the case's checklist definition,
  // not a run's review: show every item unanswered rather than hiding the
  // unjudged ones the way the Verdict tab does.
  const definition = verdicts === undefined;
  const haveModel = model.items.length > 0;

  // Item metadata by id (title + weight + domain), for the breakdown.
  const itemsById = new Map(model.items.map((item) => [item.id, item]));
  // The reviewer's verdict by item id.
  const verdictById = new Map((verdicts ?? []).map((v) => [v.id, v]));

  // Render one whole-or-sub-itemed top-level item as a row within its domain
  // group, numbered within the group.
  const renderDomainItem = (itemId: string, i: number): ReactNode => {
    const item = itemsById.get(itemId);
    // Top-level items are numbered within their group (their sub-items are
    // lettered a, b, c… beneath).
    const number = i + 1;
    // An item graded per sub-item shows its title as a heading with one nested row
    // per sub-item; a whole-item item is a single row keyed by its own id.
    if (item && (item.subItems?.length ?? 0) > 0) {
      return (
        <ChecklistItemGroup
          key={itemId}
          number={number}
          item={item}
          verdictById={verdictById}
          definition={definition}
        />
      );
    }
    return (
      <ChecklistRow
        key={itemId}
        number={number}
        title={item ? item.title : itemId}
        weight={item ? item.weight : undefined}
        graded={item?.graded}
        notScored={item?.scored === false}
        verdict={verdictById.get(itemId)}
        definition={definition}
      />
    );
  };

  // Whether any checklist item rolls up to a scoring domain. When some do, group
  // by domain; when none do (the categories grammar), group by category instead.
  const anyDomained = model.items.some((item) => !!item.domain);
  const sections: ChecklistSection[] = [];

  if (anyDomained) {
    // Group items by their domain (declared order), with un-domained items last.
    const groups: { id: string; name: string; itemIds: string[] }[] = [];
    const groupIndex = new Map<string, number>();
    const ensureGroup = (id: string, name: string): number => {
      let index = groupIndex.get(id);
      if (index === undefined) {
        index = groups.length;
        groups.push({ id, name, itemIds: [] });
        groupIndex.set(id, index);
      }
      return index;
    };
    for (const domain of model.domains) ensureGroup(domain.id, domain.name);
    for (const item of model.items) {
      const id = item.domain ?? GENERAL;
      const name =
        model.domains.find((d) => d.id === item.domain)?.name ?? "General";
      groups[ensureGroup(id, name)]!.itemIds.push(item.id);
    }
    // Empty domain groups (a declared domain no item was assigned to) never head a
    // block, and a heading only earns its space when more than one block survives.
    const nonEmpty = groups.filter((group) => group.itemIds.length > 0);
    for (const group of nonEmpty) {
      sections.push({
        key: group.id,
        heading: nonEmpty.length > 1 ? group.name : null,
        body: group.itemIds.map((itemId, i) => renderDomainItem(itemId, i)),
      });
    }
  } else {
    // Categories grammar (or any domainless case): each sub-itemed top-level item
    // is a scoring category whose title heads its points; a whole-item with no
    // sub-items lists flat beneath no heading.
    for (const item of model.items) {
      const subItems = item.subItems ?? [];
      if (subItems.length === 0) continue;
      // Definition: show every point unanswered. Verdict: the points the reviewer
      // graded, plus any excluded from scoring (surfaced "not scored" even unrated so
      // they don't vanish); a category with neither is skipped.
      const visible = definition
        ? subItems
        : subItems.filter(
            (sub) =>
              verdictById.has(subItemVerdictId(item.id, sub.id)) ||
              item.scored === false ||
              sub.scored === false,
          );
      if (visible.length === 0) continue;
      sections.push({
        key: item.id,
        heading: item.title,
        body: visible.map((sub, i) => (
          <ChecklistRow
            key={sub.id}
            number={i + 1}
            title={sub.title}
            description={sub.description}
            weight={sub.weight ?? 1}
            notScored={item.scored === false || sub.scored === false}
            verdict={verdictById.get(subItemVerdictId(item.id, sub.id))}
            definition={definition}
          />
        )),
      });
    }
    // Any whole-items (no sub-items) trail as one unlabeled block.
    const flat = model.items.filter(
      (item) => (item.subItems?.length ?? 0) === 0,
    );
    if (flat.length > 0) {
      sections.push({
        key: GENERAL,
        heading: null,
        body: flat.map((item, i) => (
          <ChecklistRow
            key={item.id}
            number={i + 1}
            title={item.title}
            weight={item.weight}
            graded={item.graded}
            notScored={item.scored === false}
            verdict={verdictById.get(item.id)}
            definition={definition}
          />
        )),
      });
    }
  }

  return (
    <div className={styles.checklist}>
      <h2 className={styles.checklistHeading}>Reviewer checklist</h2>
      {sections.map((section) => (
        <div key={section.key} className={styles.breakdownGroup}>
          {section.heading != null && (
            <h3 className={styles.breakdownGroupHeading}>{section.heading}</h3>
          )}
          <div className={styles.checklistItems}>{section.body}</div>
        </div>
      ))}
      {/* A run reviewed before the catalog carried weights (or against a case this
          host lacks) has verdicts but no grouped items; list them flat. Never
          applies to the definition view, which has no loose verdicts. */}
      {!definition &&
        !haveModel &&
        verdicts.length > 0 &&
        verdicts.every((v) => !itemsById.has(v.id)) && (
          <div className={styles.checklistItems}>
            {verdicts.map((verdict, i) => (
              <ChecklistRow
                key={verdict.id}
                number={i + 1}
                title={verdict.id}
                verdict={verdict}
              />
            ))}
          </div>
        )}
    </div>
  );
}

// A sub-itemed review item in a domain-grouped breakdown. Because a sub-itemed
// item has no single verdict, its header stands a passed/total tally (or,
// unanswered, the blank marker) in the same status gutter the Pass/Fail markers
// use, so the item still reads as a graded line aligned with the whole-item rows
// around it. Beneath it, one nested row per sub-item (lettered a, b, c…), each
// keyed by the composite `<item>.<sub>` verdict id.
//
// In the definition view every sub-item is shown unanswered; in the verdict view
// only the sub-items the reviewer actually graded render (and the item is skipped
// entirely if none were).
function ChecklistItemGroup({
  number,
  item,
  verdictById,
  definition,
}: {
  number: number;
  item: ReviewItemSummary;
  verdictById: Map<string, { status: VerdictStatus; note?: string }>;
  definition: boolean;
}) {
  const subItems = item.subItems ?? [];
  // Sub-items are always pass/fail (a graded game-jam category has no sub-items).
  // Definition: show them all, unanswered, and stand the blank marker in the
  // tally gutter. Verdict: only those actually graded render, and the tally counts
  // over exactly those so it matches the rows shown.
  const graded = definition
    ? []
    : subItems
        .map((sub) => verdictById.get(subItemVerdictId(item.id, sub.id)))
        .filter((v): v is { status: VerdictStatus; note?: string } => !!v);
  // A category with no graded sub-items is skipped — unless it carries a point
  // excluded from scoring (an erratum's `excludeFromScore`), which is still surfaced
  // "not scored" so it does not vanish. The tally below counts only graded verdicts,
  // so an excluded (unrated) point never inflates it.
  const anyExcluded =
    item.scored === false || subItems.some((sub) => sub.scored === false);
  if (!definition && graded.length === 0 && !anyExcluded) return null;
  const passed = graded.filter((v) => v.status === "pass").length;
  // The definition view has no verdict to stand in the status gutter, so it drops
  // the tally column and reads flush left rather than hanging off an empty gutter.
  return (
    <div className={styles.verdictItemGroup}>
      <span
        className={`${styles.verdictGroupHeader}${definition ? ` ${styles.verdictHeaderBare}` : ""}`}
      >
        {!definition && (
          <span className={styles.verdictGroupTally}>
            {`${passed}/${graded.length}`}
          </span>
        )}
        <span className={styles.verdictItemGroupTitle}>
          {number}. {item.title}{" "}
          {item.scored === false ? (
            <span className={styles.notScored}>not scored</span>
          ) : (
            <span className={styles.verdictWeight}>({pts(item.weight)})</span>
          )}
        </span>
      </span>
      <div className={styles.checklistSubItems}>
        {subItems.map((sub, i) => (
          <ChecklistRow
            key={sub.id}
            title={`${String.fromCharCode(97 + i)}. ${sub.title}`}
            description={sub.description}
            notScored={item.scored === false || sub.scored === false}
            verdict={verdictById.get(subItemVerdictId(item.id, sub.id))}
            definition={definition}
          />
        ))}
      </div>
    </div>
  );
}

// One checklist line: the marker in the fixed status gutter beside the item text.
// With a verdict, a binary item shows its Pass/Fail label tinted by the verdict
// and a graded game-jam category shows the grade emoji; without one (the
// definition view, or an unjudged sub-item beneath it) the gutter holds the blank
// marker. `number`, on a top-level whole-item, prefixes the title (sub-item rows
// are lettered in their `title` instead and pass none). `weight`, when given,
// trails the title dimmed as its point value — a flat weight for a binary item,
// `earned / available` for a graded one; a reviewer's note stacks beneath the
// title on its own line.
function ChecklistRow({
  number,
  title,
  description,
  weight,
  graded,
  notScored,
  verdict,
  definition,
}: {
  number?: number;
  title: string;
  description?: string | null;
  weight?: number;
  graded?: boolean;
  /** Whether this point is excluded from scoring for the version (an erratum's
   * `excludeFromScore`). Still shown and still verifiable, but it does not count
   * toward the score, so the row flags it and drops its point value. */
  notScored?: boolean;
  verdict: { status: VerdictStatus; note?: string } | undefined;
  definition?: boolean;
}) {
  // The definition view always shows a row (unanswered); the verdict view shows a
  // row where the reviewer recorded a verdict — or where the point is excluded from
  // scoring (an erratum's `excludeFromScore`), which is surfaced marked "not scored"
  // even when unrated so it does not silently vanish from the review.
  if (!verdict && !definition && !notScored) return null;
  const status = verdict?.status;
  const grade = status && isGrade(status) ? GRADE_META[status] : null;
  // A point excluded from scoring the reviewer left unrated: shown with an amber dash
  // rather than the unanswered box, so it reads as deliberately not considered.
  const notScoredMark = Boolean(notScored) && !status;
  const rowClass = notScoredMark
    ? styles.notScoredRow
    : !status
      ? styles.verdictUnanswered
      : grade
        ? styles.verdictGraded
        : VERDICT_CLASS[status as "pass" | "fail"];
  const marker = notScoredMark
    ? NOT_SCORED_MARK
    : !status
      ? UNANSWERED
      : grade
        ? grade.emoji
        : VERDICT_META[status].label;
  // A point excluded from scoring shows no point value (it earns nothing either
  // way); every other row trails its weight as usual.
  const pointsLabel =
    notScored || weight === undefined
      ? null
      : graded
        ? `${grade ? grade.points * weight : 0} / ${weight * GRADE_MAX_POINTS} pts`
        : pts(weight);
  // In the definition view there are no verdicts, so the status gutter holds no
  // marker and every row reads flush left. In verdict mode the gutter is always kept
  // so rows stay aligned: a rated row shows its Pass/Fail (or grade) marker, and a
  // not-scored point left unrated shows the blank unanswered marker rather than
  // collapsing the gutter and hanging left of its rated siblings.
  const bare = definition ?? false;
  return (
    <div
      className={`${styles.verdictRow} ${bare ? styles.verdictRowBare : rowClass}`}
    >
      {!bare && <span className={styles.verdictStatus}>{marker}</span>}
      <span className={styles.verdictItem}>
        <span className={styles.verdictItemTitle}>
          {number !== undefined && `${number}. `}
          {title}
          {pointsLabel && (
            <>
              {" "}
              <span className={styles.verdictWeight}>({pointsLabel})</span>
            </>
          )}
          {notScored && (
            <>
              {" "}
              <span className={styles.notScored}>not scored</span>
            </>
          )}
        </span>
        {description && (
          <span className={styles.secondary}>{description}</span>
        )}
        {verdict?.note && (
          <span className={styles.verdictNote}>{verdict.note}</span>
        )}
      </span>
    </div>
  );
}
