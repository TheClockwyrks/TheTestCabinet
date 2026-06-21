import { MetricTile } from "@test-cabinet/ui";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { BUILT_IN_ORCHESTRATORS } from "../../../data/orchestrators";
import { RunValidationSection } from "./RunValidationSection";
import styles from "./RunDetailPages.module.scss";

// The Metadata tab (`/runs/:runId/metadata`): the run's environment (sourced from
// inside the container) plus a link to the published source repo, followed by the
// validation widget. A run only appears here once it has completed, so no status
// is shown. Validation used to be its own tab; it now lives beneath the run info
// under a "Validation" heading.
export function RunMetadataPage() {
  return (
    <RunDetailLayout tab="metadata">
      {({ run }) => {
        const { subject, tooling, environment, links } = run;
        return (
          <>
            <section className={styles.section}>
              <h3 className={styles.sectionLabel}>Run info</h3>
              <div className={styles.metricsGrid3}>
                <MetricTile label="Operating system" value={environment.os} />
                <MetricTile
                  label="Container image"
                  value={formatContainerImage(environment.containerImage)}
                  title={environment.containerImage}
                />
                <MetricTile
                  label="Node version"
                  value={environment.nodeVersion ?? "Unknown"}
                />
                <MetricTile
                  label="Authentication"
                  value={
                    environment.authMode === "subscription"
                      ? "Subscription"
                      : "API key"
                  }
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
                  label="Orchestrator"
                  value={formatOrchestrator(subject.orchestratorSlug)}
                  title={subject.orchestratorSlug}
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
            <section className={styles.section}>
              <h3 className={styles.sectionLabel}>Validation</h3>
              <RunValidationSection run={run} />
            </section>
          </>
        );
      }}
    </RunDetailLayout>
  );
}

// The human-readable name for the run's orchestrator, mapping a built-in slug to
// its display name. An external orchestrator (run via `--orchestrator-dir`, not
// in the built-in catalogue) shows its raw slug verbatim.
function formatOrchestrator(slug: string): string {
  return (
    BUILT_IN_ORCHESTRATORS.find((o) => o.slug === slug)?.displayName ?? slug
  );
}

// Abbreviate a commit hash for display, keeping it readable while preserving a
// trailing `-dirty` marker on builds made from a modified working tree.
function formatCommit(commit: string): string {
  const [hash, ...suffix] = commit.split("-");
  const short = (hash ?? commit).slice(0, 12);
  return suffix.length > 0 ? `${short}-${suffix.join("-")}` : short;
}

// Abbreviate a container image reference for display. An image pinned by digest
// (`repo@sha256:<64 hex>`) is far too long for a tile, so the digest is shortened
// to its first 12 hex characters; the full reference is surfaced via the tile's
// hover title. Tag-only references (`repo:tag`) are shown verbatim.
function formatContainerImage(image: string): string {
  const at = image.indexOf("@sha256:");
  if (at === -1) return image;
  const repo = image.slice(0, at);
  const digest = image.slice(at + "@sha256:".length);
  return `${repo}@sha256:${digest.slice(0, 12)}…`;
}
