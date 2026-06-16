import { MetricTile } from "../../../components/MetricTile";
import { RunDetailLayout } from "../../../layouts/run/RunDetailLayout";
import styles from "./RunDetailPages.module.scss";

// The Metadata tab (`/runs/:runId/metadata`): the run's environment (sourced from
// inside the container), its automated validation signals, the source repo link,
// and the run status.
export function RunMetadataPage() {
  return (
    <RunDetailLayout tab="metadata">
      {({ run }) => {
        const { subject, tooling, environment, validation, links, status } = run;
        return (
          <>
            {/* The container the run executed in (sourced from inside it). */}
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Environment</h3>
              <div className={styles.metricsGrid}>
                <MetricTile label="Operating system" value={environment.os} />
                <MetricTile
                  label="Container image"
                  value={environment.containerImage}
                />
                <MetricTile
                  label="Node version"
                  value={environment.nodeVersion ?? "Unknown"}
                />
                <MetricTile
                  label="Harness version"
                  value={
                    subject.harnessVersion
                      ? `v${subject.harnessVersion}`
                      : "Unknown"
                  }
                />
                <MetricTile
                  label="Test Cabinet commit"
                  value={
                    tooling.testCabinetCommit
                      ? formatCommit(tooling.testCabinetCommit)
                      : "Unknown"
                  }
                />
              </div>
            </section>

            {/* Validation signals: did it boot, and how did each check fare. */}
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Validation</h3>
              <p className={styles.line}>
                Loaded:{" "}
                <span
                  className={
                    validation.loaded ? styles.loaded : styles.notLoaded
                  }
                >
                  {validation.loaded ? "Yes" : "No"}
                </span>
                {validation.detail ? (
                  <span className={styles.secondary}> — {validation.detail}</span>
                ) : null}
              </p>
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
                        <td className={styles.secondary}>
                          {check.detail ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className={`${styles.secondary} ${styles.line}`}>
                  This test case declares no checks.
                </p>
              )}
            </section>

            {/* Clone the source for yourself. */}
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Source</h3>
              {links.sourceRepo ? (
                <a
                  className={styles.source}
                  href={links.sourceRepo}
                  target="_blank"
                  rel="noreferrer"
                >
                  {links.sourceRepo}
                </a>
              ) : (
                <span className={`${styles.secondary} ${styles.line}`}>
                  No source repository was published.
                </span>
              )}
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Status</h3>
              <p className={styles.line}>
                {status.state}
                {status.detail ? ` — ${status.detail}` : ""}
              </p>
            </section>
          </>
        );
      }}
    </RunDetailLayout>
  );
}

// Abbreviate a commit hash for display, keeping it readable while preserving a
// trailing `-dirty` marker on builds made from a modified working tree.
function formatCommit(commit: string): string {
  const [hash, ...suffix] = commit.split("-");
  const short = (hash ?? commit).slice(0, 12);
  return suffix.length > 0 ? `${short}-${suffix.join("-")}` : short;
}
