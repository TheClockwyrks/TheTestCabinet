import { VariantInputsView } from "../../../components/VariantViews";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";

// The Inputs tab (`/test-cases/:slug/inputs`): everything a run of the anchored
// coordinate is given — the prompt the harness hands the model, the files it is
// seeded with, and the reference media it is judged against — gathered into one
// list, each entry tagged with its input kind. The rendering is shared with the
// run's Inputs tab via `VariantInputsView`, so a case's inputs read the same
// whether reached from the catalog or from a run that exercised them.
//
// Which inputs those are is the page's anchored coordinate: the version, the
// variant, and the engine selected in the header. The layout resolves that
// coordinate through the same per-(version, variant, engine) resolver a run's
// Inputs tab uses, so the two surfaces cannot drift; this tab only renders the
// result.
export function TestCaseInputsPage() {
  return (
    <TestCaseDetailLayout tab="inputs">
      {({ version, engine, variant }) => (
        // Keyed by the whole coordinate so switching any dimension collapses the
        // panels again rather than leaving one open over different text.
        <VariantInputsView
          key={`${version}/${variant.slug}/${engine}`}
          variant={variant}
        />
      )}
    </TestCaseDetailLayout>
  );
}
