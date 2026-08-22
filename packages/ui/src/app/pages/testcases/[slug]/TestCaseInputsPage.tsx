import { useId } from "react";
import { Panel } from "@test-cabinet/ui";
import { LoadingState } from "../../../components/LoadingState";
import { VariantInputsView } from "../../../components/VariantViews";
import { engineName } from "../../../data/engines";
import type { TestCaseDetail, VariantSummary } from "../../../data/testCases";
import { useCaseVariant } from "../../../data/useRunVariant";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import {
  useSelectedRendering,
  type SelectedRendering,
} from "./useSelectedRendering";
import styles from "./TestCaseInputsPage.module.scss";
import pageStyles from "./TestCaseDetailPages.module.scss";

// The Inputs tab (`/test-cases/:slug/inputs`): everything a run of the selected
// variant is given — the prompt the harness hands the model, the files it is
// seeded with, and the reference media it is judged against — gathered into one
// list, each entry tagged with its input kind. The rendering is shared with the
// run's Inputs tab via `VariantInputsView`, so a case's inputs read the same
// whether reached from the catalog or from a run that exercised them.
//
// Which inputs those are is three choices, not one: the variant (chosen in the
// page header, shared with every tab) and — chosen here, because they are
// dimensions of the inputs alone — the case version and the engine. A case's
// `prompt.hbs` and its `.hbs` specs branch on the selected engine, so a case
// supporting one has a whole set of inputs that the engineless rendering does not
// show; and a superseded version is the deliverable its own runs were judged
// against. Both are resolved through the same per-(version, variant, engine)
// resolver a run's Inputs tab uses, so the two surfaces cannot drift.
export function TestCaseInputsPage() {
  return (
    <TestCaseDetailLayout tab="inputs">
      {({ testCase, variant }) => (
        <TestCaseInputsBody testCase={testCase} variant={variant} />
      )}
    </TestCaseDetailLayout>
  );
}

function TestCaseInputsBody({
  testCase,
  variant,
}: {
  testCase: TestCaseDetail;
  variant: VariantSummary;
}) {
  const rendering = useSelectedRendering(testCase);
  const { version, engine } = rendering;
  // The header's variant selector names a variant of the case; this resolves that
  // variant of the SELECTED version, which is why the resolution can legitimately
  // come back empty — a variant added after an older version simply is not in it.
  const { variant: resolved, status } = useCaseVariant(
    testCase.slug,
    version,
    variant.slug,
    engine,
  );

  return (
    <>
      <RenderingControls state={rendering} />
      {status === "loading" ? (
        // The inputs are fetched per rendering, so this body renders while that
        // fetch is in flight on every switch. "Not available" is reserved for a
        // settled fetch that found nothing.
        <LoadingState size="section" label="Loading inputs…" />
      ) : resolved ? (
        // Keyed by the whole rendering so switching version or engine collapses
        // the panels again rather than leaving one open over different text.
        <VariantInputsView
          key={`${version}/${variant.slug}/${engine}`}
          variant={resolved}
        />
      ) : (
        <Panel>
          <p className={pageStyles.empty}>
            No inputs for {variant.name} at {version} on {engineName(engine)}.
          </p>
        </Panel>
      )}
    </>
  );
}

// The version and engine pickers. Each is shown only when it offers a choice: a
// case with one published version and no engine has exactly one set of inputs, and
// a dropdown that cannot be changed says nothing the page does not already show.
// With neither on offer the row is left off entirely, which is the common case and
// leaves the tab reading as it did before.
function RenderingControls({ state }: { state: SelectedRendering }) {
  const versionId = useId();
  const engineId = useId();
  const showVersion = state.versions.length > 1;
  const showEngine = state.engines.length > 1;
  if (!showVersion && !showEngine) return null;
  return (
    <div className={styles.controls}>
      {showVersion && (
        <div className={styles.control}>
          <label className={styles.label} htmlFor={versionId}>
            Version
          </label>
          <select
            id={versionId}
            className={styles.select}
            value={state.version}
            onChange={(event) => state.setVersion(event.target.value)}
          >
            {state.versions.map((version) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </select>
        </div>
      )}
      {showEngine && (
        <div className={styles.control}>
          <label className={styles.label} htmlFor={engineId}>
            Engine
          </label>
          <select
            id={engineId}
            className={styles.select}
            value={state.engine}
            onChange={(event) => state.setEngine(event.target.value)}
          >
            {state.engines.map((slug) => (
              <option key={slug} value={slug}>
                {engineName(slug)}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
