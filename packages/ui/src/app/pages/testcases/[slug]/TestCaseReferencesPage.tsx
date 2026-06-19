import { VariantReferencesView } from "../../../components/VariantViews";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";

// The References tab (`/test-cases/:slug/references`): the rendered reference
// screenshots that are the visual targets for the selected variant. The
// rendering is shared with the run's References tab via `VariantReferencesView`,
// so the same targets read identically whether reached from the catalog or from
// a run validated against them.
export function TestCaseReferencesPage() {
  return (
    <TestCaseDetailLayout tab="references">
      {({ variant }) => <VariantReferencesView variant={variant} />}
    </TestCaseDetailLayout>
  );
}
