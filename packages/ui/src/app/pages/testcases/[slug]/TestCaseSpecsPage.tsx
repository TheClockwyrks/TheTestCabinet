import { VariantSpecsView } from "../../../components/VariantViews";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";

// The Specifications tab (`/test-cases/:slug/specs`): the prompt the harness
// hands the model, followed by the exact files a run of the selected variant is
// seeded with. The rendering is shared with the run's Specifications tab via
// `VariantSpecsView`, so a case's specs read the same whether reached from the
// catalog or from a run that exercised them.
export function TestCaseSpecsPage() {
  return (
    <TestCaseDetailLayout tab="specs">
      {({ variant }) => <VariantSpecsView variant={variant} />}
    </TestCaseDetailLayout>
  );
}
