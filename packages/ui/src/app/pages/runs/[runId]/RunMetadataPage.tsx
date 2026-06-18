import { MetricTile } from "@test-cabinet/ui";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import styles from "./RunDetailPages.module.scss";

// The Metadata tab (`/runs/:runId/metadata`): the run's environment (sourced from
// inside the container) plus a link to the published source repo, all as a
// single grid of tiles. Validation lives on its own tab; a run only appears here
// once it has completed, so no status is shown.
export function RunMetadataPage() {
  return (
    <RunDetailLayout tab="metadata">
      {({ run }) => {
        const { subject, tooling, environment, links } = run;
        return (
          <section className={styles.section}>
            <div className={styles.metricsGrid3}>
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
              <MetricTile
                label="Source"
                value={links.sourceRepo ? "GitHub" : "Not published"}
                href={links.sourceRepo ?? undefined}
                secondary={!links.sourceRepo}
              />
            </div>
          </section>
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
