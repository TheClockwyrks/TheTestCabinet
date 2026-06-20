import { VariantInputsView } from "../../../components/VariantViews";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";

// The Inputs tab (`/test-cases/:slug/inputs`): everything a run of the selected
// variant is given — the prompt the harness hands the model, the files it is
// seeded with, and the reference media it is judged against — gathered into one
// list, each entry tagged with its input kind. The rendering is shared with the
// run's Inputs tab via `VariantInputsView`, so a case's inputs read the same
// whether reached from the catalog or from a run that exercised them.
export function TestCaseInputsPage() {
  return (
    <TestCaseDetailLayout tab="inputs">
      {({ variant }) => <VariantInputsView variant={variant} />}
    </TestCaseDetailLayout>
  );
}
