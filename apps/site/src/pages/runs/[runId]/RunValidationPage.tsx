import { Panel } from "../../../components/Panel";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import type { StepResult } from "@test-cabinet/run-record";
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

// The Validation tab (`/runs/:runId/validation`): the automated signals derived
// from running the produced artifact. Building is not a single opaque step, so
// the required install and build steps are reported alongside the load signal
// and the per-view breakdown of the checks the test case declares.
export function RunValidationPage() {
  return (
    <RunDetailLayout tab="validation">
      {({ run }) => {
        const { validation } = run;
        // The required steps every run performs, in the order they run: install,
        // then build, then the overall load signal that depends on both.
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
                        <span
                          className={step.ok ? styles.loaded : styles.notLoaded}
                        >
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
