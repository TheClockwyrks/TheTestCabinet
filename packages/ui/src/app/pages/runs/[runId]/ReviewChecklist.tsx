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

// The id used to group review items that belong to no declared domain.
const GENERAL = "__general__";

// Format a point weight as `1 pt` / `2 pts`.
function pts(weight: number): string {
  return `${weight} ${weight === 1 ? "pt" : "pts"}`;
}

// The reviewer's per-item checklist, grouped by scoring domain. Shared by the run
// Verdict tab — which passes the reviewer's recorded `verdicts`, so each row shows
// its Pass/Fail (or graded-emoji) marker — and the test-case Reviewing tab, which
// passes none, rendering the blank checklist a reviewer would work through with
// every declared item and sub-item shown unanswered.
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

  return (
    <div className={styles.checklist}>
      <h2 className={styles.checklistHeading}>Reviewer checklist</h2>
      {groups
        .filter((group) => group.itemIds.length > 0)
        .map((group) => (
          <div key={group.id} className={styles.breakdownGroup}>
            {groups.length > 1 && (
              <h3 className={styles.breakdownGroupHeading}>{group.name}</h3>
            )}
            <ul className={styles.checklistItems}>
              {group.itemIds.map((itemId, i) => {
                const item = itemsById.get(itemId);
                // Top-level items are numbered within their group (their
                // sub-items are lettered a, b, c… beneath).
                const number = i + 1;
                // An item graded per sub-item shows its title as a heading with
                // one nested row per sub-item; a whole-item item is a single row
                // keyed by its own id.
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
                    verdict={verdictById.get(itemId)}
                    definition={definition}
                  />
                );
              })}
            </ul>
          </div>
        ))}
      {/* A run reviewed before the catalog carried weights (or against a case this
          host lacks) has verdicts but no grouped items; list them flat. Never
          applies to the definition view, which has no loose verdicts. */}
      {!definition &&
        !haveModel &&
        verdicts.length > 0 &&
        verdicts.every((v) => !itemsById.has(v.id)) && (
          <ul className={styles.checklistItems}>
            {verdicts.map((verdict, i) => (
              <ChecklistRow
                key={verdict.id}
                number={i + 1}
                title={verdict.id}
                verdict={verdict}
              />
            ))}
          </ul>
        )}
    </div>
  );
}

// A sub-itemed review item in the breakdown. Because a sub-itemed item has no
// single verdict, its header stands a passed/total tally (or, unanswered, the
// blank marker) in the same status gutter the Pass/Fail markers use, so the item
// still reads as a graded line aligned with the whole-item rows around it. Beneath
// it, one nested row per sub-item (lettered a, b, c…), each keyed by the composite
// `<item>.<sub>` verdict id.
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
  if (!definition && graded.length === 0) return null;
  const passed = graded.filter((v) => v.status === "pass").length;
  return (
    <li className={styles.verdictItemGroup}>
      <span className={styles.verdictGroupHeader}>
        <span className={styles.verdictGroupTally}>
          {definition ? UNANSWERED : `${passed}/${graded.length}`}
        </span>
        <span className={styles.verdictItemGroupTitle}>
          {number}. {item.title}{" "}
          <span className={styles.verdictWeight}>({pts(item.weight)})</span>
        </span>
      </span>
      <ul className={styles.checklistSubItems}>
        {subItems.map((sub, i) => (
          <ChecklistRow
            key={sub.id}
            title={`${String.fromCharCode(97 + i)}. ${sub.title}`}
            verdict={verdictById.get(subItemVerdictId(item.id, sub.id))}
            definition={definition}
          />
        ))}
      </ul>
    </li>
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
  weight,
  graded,
  verdict,
  definition,
}: {
  number?: number;
  title: string;
  weight?: number;
  graded?: boolean;
  verdict: { status: VerdictStatus; note?: string } | undefined;
  definition?: boolean;
}) {
  // The definition view always shows a row (unanswered); the verdict view shows a
  // row only where the reviewer recorded a verdict.
  if (!verdict && !definition) return null;
  const status = verdict?.status;
  const grade = status && isGrade(status) ? GRADE_META[status] : null;
  const rowClass = !status
    ? styles.verdictUnanswered
    : grade
      ? styles.verdictGraded
      : VERDICT_CLASS[status as "pass" | "fail"];
  const marker = !status
    ? UNANSWERED
    : grade
      ? grade.emoji
      : VERDICT_META[status].label;
  const pointsLabel =
    weight === undefined
      ? null
      : graded
        ? `${grade ? grade.points * weight : 0} / ${weight * GRADE_MAX_POINTS} pts`
        : pts(weight);
  return (
    <li className={`${styles.verdictRow} ${rowClass}`}>
      <span className={styles.verdictStatus}>{marker}</span>
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
        </span>
        {verdict?.note && (
          <span className={styles.verdictNote}>{verdict.note}</span>
        )}
      </span>
    </li>
  );
}
