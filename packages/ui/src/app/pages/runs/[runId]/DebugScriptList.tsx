import type { DebugScriptResult } from "@test-cabinet/run-record";
import styles from "./RunDetailPages.module.scss";

// The automated-validation debug scripts a case's instrumented items declare, each
// row modeled on the Install/Build step table: the verdict unit it backs (the item's
// title, or `item — sub-item` for a per-sub-item driver, plus the reporter-side script
// path), whether it ran to completion against a conformant build (the debug-API gate),
// and the detail of any failure. Shared by the Metadata tab's validation widget, the
// top of the Verdict editor, and the auto-fail failure panel.
//
// `failedOnly` narrows to the scripts that failed the gate (`ran: false`) — used on
// the failure branch to explain exactly which contracts broke. `heading`, when
// given, titles the table.
export function DebugScriptList({
  scripts,
  failedOnly = false,
  heading,
}: {
  scripts: DebugScriptResult[];
  failedOnly?: boolean;
  heading?: string;
}) {
  const shown = failedOnly ? scripts.filter((s) => !s.ran) : scripts;
  if (shown.length === 0) return null;
  return (
    <div className={styles.section}>
      {heading && <h3 className={styles.checkName}>{heading}</h3>}
      <table className={styles.checks}>
        <thead>
          <tr>
            <th scope="col">Script</th>
            <th scope="col">Ran</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((script) => (
            <tr
              key={
                script.subItemId
                  ? `${script.itemId}.${script.subItemId}`
                  : script.itemId
              }
            >
              <th scope="row" className={styles.checkName}>
                {script.title}
                <span className={styles.secondary}> — {script.script}</span>
              </th>
              <td>
                <span className={script.ran ? styles.loaded : styles.notLoaded}>
                  {script.ran ? "Yes" : "No"}
                </span>
              </td>
              <td className={styles.secondary}>{script.detail ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
