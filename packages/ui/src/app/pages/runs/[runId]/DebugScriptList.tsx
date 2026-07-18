import { useState } from "react";

import type { DebugScriptResult } from "@test-cabinet/run-record";

import styles from "./RunDetailPages.module.scss";

// The automated-validation debug scripts a case's instrumented items declare,
// grouped into one table per review CATEGORY (a script backs a single review item,
// so its category is known). Each row is the review item it backs — its title, the
// reporter-side script path, and whether the check passed — and expands on click to
// reveal any failure detail and the per-verdict assertions: the individual
// mechanical facts the script checked, each pass or fail, exactly as a code test
// framework lists every `assert`. Shared by the Metadata tab's validation widget,
// the top of the Verdict editor, and the auto-fail failure panel.
//
// `failedOnly` narrows to the scripts that failed the debug-API gate (`ran: false`)
// — used on the failure branch to explain exactly which contracts broke. `heading`,
// when given, titles the whole section.
export function DebugScriptList({
  scripts,
  failedOnly = false,
  heading,
}: {
  scripts: DebugScriptResult[];
  failedOnly?: boolean;
  heading?: string;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const shown = failedOnly ? scripts.filter((s) => !s.ran) : scripts;
  if (shown.length === 0) return null;

  // Group by the backing category, preserving first-seen order of both the
  // categories and the scripts within each. A script's `categoryTitle` is the
  // review item that owns it; `itemId` keys the group so titles never collide.
  const groups: { key: string; title: string; scripts: DebugScriptResult[] }[] =
    [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const script of shown) {
    let group = byKey.get(script.itemId);
    if (!group) {
      group = {
        key: script.itemId,
        title: script.categoryTitle || script.title,
        scripts: [],
      };
      byKey.set(script.itemId, group);
      groups.push(group);
    }
    group.scripts.push(script);
  }

  const rowKey = (s: DebugScriptResult) =>
    s.subItemId ? `${s.itemId}.${s.subItemId}` : s.itemId;

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className={styles.section}>
      {heading && <h3 className={styles.checkName}>{heading}</h3>}
      {groups.map((group) => (
        <div key={group.key} className={styles.validationGroup}>
          <h4 className={styles.validationCategory}>{group.title}</h4>
          <table className={styles.checks}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Path</th>
                <th scope="col">Pass</th>
              </tr>
            </thead>
            <tbody>
              {group.scripts.map((script) => {
                const key = rowKey(script);
                // "Pass" is the check's outcome: it ran to completion and every
                // verdict it decided passed. A script that never ran (the debug-API
                // gate broke) has no outcome to show.
                const passed =
                  script.ran &&
                  script.verdicts.length > 0 &&
                  script.verdicts.every((v) => v.pass);
                // The assertions across every verdict this script decided — the
                // proof to reveal on expand (both the parts that held and any that
                // failed).
                const assertions = script.verdicts.flatMap((v) => v.assertions);
                const canExpand =
                  Boolean(script.detail) || assertions.length > 0;
                const isOpen = canExpand && expanded.has(key);
                return (
                  <ExpandableRows
                    key={key}
                    script={script}
                    passed={passed}
                    assertions={assertions}
                    canExpand={canExpand}
                    isOpen={isOpen}
                    onToggle={() => toggle(key)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// One review-item row plus, when open, its detail panel. Kept together so a single
// map emits the pair of `<tr>`s a `<tbody>` requires.
function ExpandableRows({
  script,
  passed,
  assertions,
  canExpand,
  isOpen,
  onToggle,
}: {
  script: DebugScriptResult;
  passed: boolean;
  assertions: DebugScriptResult["verdicts"][number]["assertions"];
  canExpand: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={canExpand ? styles.expandableRow : undefined}
        onClick={canExpand ? onToggle : undefined}
        aria-expanded={canExpand ? isOpen : undefined}
      >
        <th scope="row" className={styles.checkName}>
          {canExpand && (
            <span className={styles.twisty} aria-hidden="true">
              {isOpen ? "▾" : "▸"}
            </span>
          )}
          {script.title}
        </th>
        <td className={styles.secondary}>{script.script}</td>
        <td>
          {script.ran ? (
            <span className={passed ? styles.loaded : styles.notLoaded}>
              {passed ? "Pass" : "Fail"}
            </span>
          ) : (
            <span className={styles.notLoaded}>Did not run</span>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className={styles.detailRow}>
          <td colSpan={3}>
            {script.detail && (
              <p className={styles.secondary}>{script.detail}</p>
            )}
            {assertions.length > 0 && (
              <ul className={styles.detailNotes}>
                {assertions.map((a, i) => (
                  <li key={i}>
                    <span className={a.pass ? styles.loaded : styles.notLoaded}>
                      {a.pass ? "Pass" : "Fail"}
                    </span>{" "}
                    {a.label}
                    {/* A failing comparison shows what it required vs. observed. */}
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
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
