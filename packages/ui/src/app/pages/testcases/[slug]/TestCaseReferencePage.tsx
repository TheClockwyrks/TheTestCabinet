import { ReferencePlayable } from "../../../components/PlayableEmbed";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";

// The Reference tab (`/test-cases/:slug/reference`): the authored, in-repo,
// versioned static build that is the *correct* implementation of the selected
// variant, embedded inline. It is the case-variant analogue of a run's Play tab —
// but where a run's build is unedited model code shown behind a caveat, a
// reference implementation is the correct build (already redacted at publish), so
// it loads inline with a fullscreen toggle and no caveat.
//
// The layout only surfaces this tab for an end-to-end case whose selected variant
// carries a `referenceBuild`, so reaching it normally means one is present. A
// hand-typed URL (or a variant switch to one without a build) still resolves here,
// where `ReferencePlayable` degrades to a short "no reference implementation"
// placeholder.
export function TestCaseReferencePage() {
  return (
    <TestCaseDetailLayout tab="reference">
      {({ variant }) => (
        <ReferencePlayable
          referenceBuild={variant.referenceBuild}
          variantName={variant.name}
        />
      )}
    </TestCaseDetailLayout>
  );
}
