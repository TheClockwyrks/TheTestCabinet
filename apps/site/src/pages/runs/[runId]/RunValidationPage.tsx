import { Panel } from "../../../components/Panel";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import styles from "./RunDetailPages.module.scss";

// The Validation tab (`/runs/:runId/validation`): the automated signals derived
// from running the produced artifact — a per-view breakdown of the checks the
// test case declares, presented as a table inside a single panel.
export function RunValidationPage() {
  return (
    <RunDetailLayout tab="validation">
      {({ run }) => {
        const { validation } = run;
        return (
          <Panel>
            {validation.checks.length > 0 ? (
              <table className={styles.checks}>
                <thead>
                  <tr>
                    <th scope="col">Check</th>
                    <th scope="col">Reached</th>
                    <th scope="col">Similarity</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.checks.map((check) => (
                    <tr key={check.view}>
                      <th scope="row" className={styles.checkName}>
                        {check.name}
                      </th>
                      <td>
                        <span
                          className={
                            check.reached ? styles.loaded : styles.notLoaded
                          }
                        >
                          {check.reached ? "Yes" : "No"}
                        </span>
                      </td>
                      <td>
                        {check.reached
                          ? `${(check.similarity * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className={styles.secondary}>{check.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className={styles.empty}>This test case declares no checks.</p>
            )}
          </Panel>
        );
      }}
    </RunDetailLayout>
  );
}
