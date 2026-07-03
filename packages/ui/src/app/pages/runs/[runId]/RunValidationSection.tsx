import { Panel } from "@test-cabinet/ui";
import type { RunRecord, StepResult } from "@test-cabinet/run-record";
import styles from "./RunDetailPages.module.scss";

// One row in the required-steps table: a human label plus the outcome to render.
// `ok` drives the Yes/No styling; `null` means the step was never reached.
type Step = {
  label: string;
  ok: boolean | null;
  detail: string | null;
};

// Resolve a build step (install or build) into a table row. A missing step
// (`null`) was never reached — for example, the build step when the install
// failed — and is reported as such rather than as a pass or a failure.
function buildStep(label: string, step: StepResult | null): Step {
  return {
    label,
    ok: step ? step.succeeded : null,
    detail: step?.detail ?? null,
  };
}

// The validation widget: the automated signals derived from running the produced
// artifact. Building is not a single opaque step, so the required install and
// build steps are reported alongside the load signal and the per-view breakdown
// of the checks the test case declares. Rendered on the Metadata tab beneath the
// run info.
export function RunValidationSection({ run }: { run: RunRecord }) {
  const { validation } = run;
  // An asset-generation run has no build or per-view checks; its validation is
  // the regenerate-and-score result, surfaced as its own table. Sprite/sheet runs
  // carry `asset`; the two voxel kinds carry `voxel`.
  if (validation.asset) {
    return <AssetValidationTable run={run} />;
  }
  if (validation.voxel) {
    return <VoxelValidationTable run={run} />;
  }
  // The required steps every run performs, in the order they run: install, then
  // build, then the overall load signal that depends on both.
  const steps: Step[] = [
    buildStep("Install", validation.install),
    buildStep("Build", validation.build),
    { label: "Loaded", ok: validation.loaded, detail: validation.detail },
  ];
  return (
    <Panel>
      <table className={`${styles.checks} ${styles.section}`}>
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Result</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step) => (
            <tr key={step.label}>
              <th scope="row" className={styles.checkName}>
                {step.label}
              </th>
              <td>
                {step.ok === null ? (
                  <span className={styles.secondary}>Not reached</span>
                ) : (
                  <span className={step.ok ? styles.loaded : styles.notLoaded}>
                    {step.ok ? "Yes" : "No"}
                  </span>
                )}
              </td>
              <td className={styles.secondary}>{step.detail ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
                    className={check.reached ? styles.loaded : styles.notLoaded}
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
}

// The validation widget for an asset-generation run: the run regenerated
// image(s) (the load signal) and whether the model drew outside the tool (cheat
// divergence). A single sprite is one frame; a sprite sheet has one row per
// frame. There is no target image or fidelity score — the regenerated asset is
// reviewed against the brief on the Verdict tab; this is the recorded numbers.
function AssetValidationTable({ run }: { run: RunRecord }) {
  const { validation } = run;
  const asset = validation.asset!;
  const isSheet = !!asset.sheet;
  return (
    <Panel>
      <table className={`${styles.checks} ${styles.section}`}>
        <tbody>
          <tr>
            <th scope="row" className={styles.checkName}>
              Regenerated
            </th>
            <td>
              <span
                className={validation.loaded ? styles.loaded : styles.notLoaded}
              >
                {validation.loaded ? "Yes" : "No"}
              </span>
            </td>
            <td className={styles.secondary}>
              {isSheet
                ? `${asset.frames.length} frames`
                : `${asset.frames[0]?.operationCount ?? 0} operations`}{" "}
              · {validation.detail ?? "—"}
            </td>
          </tr>
          {asset.frames.map((frame) => {
            const drewOutsideTool =
              frame.cheatDivergence !== null && frame.cheatDivergence > 0.05;
            const label = isSheet ? `Frame ${frame.index}` : "Sprite";
            return (
              <tr key={frame.index}>
                <th scope="row" className={styles.checkName}>
                  {label}
                </th>
                <td>{frame.operationCount} ops</td>
                <td className={styles.secondary}>
                  {frame.cheatDivergence === null ? (
                    frame.detail ?? "—"
                  ) : (
                    <span
                      className={
                        drewOutsideTool ? styles.notLoaded : styles.loaded
                      }
                    >
                      divergence {(frame.cheatDivergence * 100).toFixed(1)}%
                      {drewOutsideTool ? " — drew outside the tool" : ""}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

// The validation widget for a voxel asset-generation run: the run regenerated
// model(s) (the load signal) and how many voxels each part contains. A static
// model is one part; an animated model has one row per declared part. Cheat
// detection is retired for the voxel family, so — unlike the sprite table — there
// is no divergence column. As with the sprite table there is no target model or
// fidelity score — the regenerated model is reviewed against the brief on the
// Verdict tab.
function VoxelValidationTable({ run }: { run: RunRecord }) {
  const { validation } = run;
  const voxel = validation.voxel!;
  const animated = !!voxel.model || !!voxel.rig;
  return (
    <Panel>
      <table className={`${styles.checks} ${styles.section}`}>
        <tbody>
          <tr>
            <th scope="row" className={styles.checkName}>
              Regenerated
            </th>
            <td>
              <span
                className={validation.loaded ? styles.loaded : styles.notLoaded}
              >
                {validation.loaded ? "Yes" : "No"}
              </span>
            </td>
            <td className={styles.secondary}>
              {animated
                ? `${voxel.parts.length} parts`
                : `${voxel.parts[0]?.operationCount ?? 0} operations`}{" "}
              · {validation.detail ?? "—"}
            </td>
          </tr>
          {voxel.parts.map((part) => {
            const label = animated ? part.name : "Model";
            return (
              <tr key={part.name}>
                <th scope="row" className={styles.checkName}>
                  {label}
                </th>
                <td>
                  {part.operationCount} ops · {part.voxelCount} voxels
                </td>
                <td className={styles.secondary}>{part.detail ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
