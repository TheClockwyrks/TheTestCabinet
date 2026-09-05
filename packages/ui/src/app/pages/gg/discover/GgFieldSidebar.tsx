// The **field browser** — every field in the corpus, its kind, its document count and its
// top values, click to insert.
//
// Stated plainly in the design: *this is not polish*. A text language is strictly harder
// to start with than a widget builder, and without a browser showing what is actually in
// the corpus the redesign is a downgrade for the first five minutes of use. It carries an
// extra load beyond discoverability, too — it is where a **sparse** field becomes visible.
// `tool.*` is deliberately sparse (the tool universe is per-run, so there is no honest
// closed set to write `false` over), and `tool.editFile — 12` beside a corpus of 400 tells
// an operator something an empty result never would.
//
// Fields are grouped by their first dotted segment because that is how the document is
// actually laid out — `cap.*`, `tool.*`, `summary.*`, `metric.*` — and a flat list of
// several hundred names is a list nobody reads.
import { useMemo, useState } from "react";
import { Spinner } from "@clockwyrks/ui";
import type {
  GgFieldCatalog,
  GgFieldInfo,
} from "@clockwyrks/run-record/gg-query";
import { asDisplay, formatIdentifier, formatLiteral } from "../query";
import styles from "./GgDiscover.module.scss";

interface GgFieldSidebarProps {
  catalog: GgFieldCatalog;
  /** Insert text at the caret — a field name, or a whole `field:value` predicate. */
  onInsert: (text: string) => void;
  /** Whether the catalog is still loading, so an empty list can say which empty it is. */
  loading?: boolean;
}

/** One namespace's fields. */
interface FieldGroup {
  name: string;
  fields: GgFieldInfo[];
}

/**
 * The namespaces in the order they are shown, ahead of everything else alphabetically.
 *
 * Identity and outcome first because they answer "which runs?", then configuration,
 * then the two open namespaces a feature grows without asking anyone. `has` is last: its
 * markers exist to make a denominator explicit, which is a thing an operator reaches for
 * second, after a query already returns something surprising.
 */
const NAMESPACE_ORDER = [
  "",
  "metric",
  "cap",
  "agent",
  "model",
  "tool",
  "summary",
  "code",
  "has",
];

/** The label a namespace shows under. The empty prefix holds the un-namespaced fields —
 *  `id`, `state`, `case`, `model`, `score` — which are the ones an operator starts with. */
const NAMESPACE_LABELS: Record<string, string> = {
  "": "Run",
  metric: "Metrics",
  cap: "Capabilities",
  agent: "Agents",
  model: "Per-model spend",
  tool: "Tools",
  summary: "Session summary",
  code: "Code analysis",
  has: "Presence markers",
};

export function GgFieldSidebar({
  catalog,
  onInsert,
  loading = false,
}: GgFieldSidebarProps) {
  const [needle, setNeedle] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const groups = useMemo(
    () => groupFields(catalog.fields, needle),
    [catalog.fields, needle],
  );

  return (
    <aside className={styles.sidebar} aria-label="Fields">
      <div className={styles.sidebarHead}>
        <h2 className={styles.sidebarTitle}>Fields</h2>
        <span className={styles.sidebarCount}>
          {catalog.documents.toLocaleString("en-US")} runs
        </span>
      </div>
      <input
        className={styles.sidebarSearch}
        type="search"
        value={needle}
        placeholder="Filter fields…"
        aria-label="Filter fields"
        onChange={(event) => setNeedle(event.target.value)}
      />

      {groups.length === 0 ? (
        loading ? (
          <Spinner variant="flap" label="Loading fields…" />
        ) : (
          <p className={styles.sidebarEmpty}>
            {needle
              ? "No field matches that."
              : "No gg runs have been recorded yet."}
          </p>
        )
      ) : (
        groups.map((group) => (
          <section key={group.name} className={styles.fieldGroup}>
            <h3 className={styles.fieldGroupTitle}>
              {NAMESPACE_LABELS[group.name] ?? group.name}
            </h3>
            <ul className={styles.fieldList}>
              {group.fields.map((field) => {
                const isOpen = expanded === field.name;
                return (
                  <li key={field.name} className={styles.fieldItem}>
                    <div className={styles.fieldRow}>
                      <button
                        type="button"
                        className={styles.fieldName}
                        title={`Insert ${field.name}`}
                        onClick={() => onInsert(fieldText(field.name))}
                      >
                        {field.name}
                      </button>
                      {/* The document count, always shown — the number that makes a
                          deliberately sparse field visible before it is queried. */}
                      <span
                        className={styles.fieldCount}
                        title="Documents carrying it"
                      >
                        {field.documents.toLocaleString("en-US")}
                      </span>
                      <span className={styles.fieldKind}>{field.kind}</span>
                      {(field.topValues?.length ?? 0) > 0 && (
                        <button
                          type="button"
                          className={styles.fieldExpand}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Show"} values of ${field.name}`}
                          onClick={() =>
                            setExpanded(isOpen ? null : field.name)
                          }
                        >
                          {isOpen ? "−" : "+"}
                        </button>
                      )}
                    </div>
                    {isOpen && (
                      <ul className={styles.valueList}>
                        {(field.topValues ?? []).map((entry) => (
                          <li key={asDisplay(entry.value)}>
                            <button
                              type="button"
                              className={styles.valueRow}
                              onClick={() =>
                                onInsert(predicateText(field.name, entry.value))
                              }
                            >
                              <span className={styles.valueName}>
                                {asDisplay(entry.value)}
                              </span>
                              <span className={styles.valueCount}>
                                {entry.count.toLocaleString("en-US")}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </aside>
  );
}

/**
 * Group the catalog by namespace, filtered by the search box.
 *
 * The filter matches the whole dotted name, so typing `compaction` finds
 * `cap.compaction.summaryHeadroom` as well as `cap.compaction` — which is the point, since
 * the params are exactly the fields nobody knows exist.
 */
function groupFields(
  fields: readonly GgFieldInfo[],
  needle: string,
): FieldGroup[] {
  const lowered = needle.trim().toLowerCase();
  const byNamespace = new Map<string, GgFieldInfo[]>();
  for (const field of fields) {
    if (lowered && !field.name.toLowerCase().includes(lowered)) continue;
    const dot = field.name.indexOf(".");
    const namespace = dot === -1 ? "" : field.name.slice(0, dot);
    const bucket = byNamespace.get(namespace);
    if (bucket) bucket.push(field);
    else byNamespace.set(namespace, [field]);
  }
  return [...byNamespace.entries()]
    .map(([name, group]) => ({ name, fields: group }))
    .sort(
      (a, b) =>
        namespaceRank(a.name) - namespaceRank(b.name) ||
        (a.name < b.name ? -1 : 1),
    );
}

/** Where a namespace sits: the curated order first, everything else after it. */
function namespaceRank(name: string): number {
  const at = NAMESPACE_ORDER.indexOf(name);
  return at === -1 ? NAMESPACE_ORDER.length : at;
}

/** A field name as query text, with only the segments that need it quoted. */
function fieldText(name: string): string {
  return name.split(".").map(formatIdentifier).join(".");
}

/** A whole `field:value` predicate — what clicking an observed value inserts, because the
 *  value is only ever interesting as a filter on the field it came from. */
function predicateText(name: string, value: string | number | boolean): string {
  const rendered = asDisplay(value);
  const literal =
    typeof value === "string"
      ? formatLiteral({
          raw: rendered,
          quoted: false,
          span: { start: 0, end: 0 },
        })
      : rendered;
  return `${fieldText(name)}:${literal}`;
}
