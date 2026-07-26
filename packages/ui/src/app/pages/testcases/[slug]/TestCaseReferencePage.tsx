import { ReferencePlayable } from "../../../components/PlayableEmbed";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import { ReferenceSheetView } from "./ReferenceSheetView";

// The Reference tab (`/test-cases/:slug/reference`): the authored, in-repo,
// versioned *correct* answer for the selected variant. What that is depends on what
// the case produces, so this tab renders one of two things:
//
//   • An end-to-end / full-stack variant's reference is a deployed static build, so
//     it is embedded inline. It is the case-variant analogue of a run's Play tab —
//     but where a run's build is unedited model code shown behind a caveat, a
//     reference implementation is the correct build (already redacted at publish),
//     so it loads inline with a fullscreen toggle and no caveat.
//   • An asset-generation variant's reference is *data*, not a page: the rendered
//     frames plus the action log each was drawn from, published to the snapshot
//     bucket. There is nothing to embed, so they are rendered natively — see
//     `ReferenceSheetView`.
//
// A variant carries at most one of the two signals in practice (a case is a single
// test type), so the branch is a genuine either/or rather than a precedence
// decision; `referenceBuild` is checked first only because it is the older shape.
//
// The layout only surfaces this tab for a variant carrying one of them, so reaching
// it normally means one is present. A hand-typed URL (or a variant switch to one
// with neither) still resolves here, where `ReferencePlayable` degrades to a short
// "no reference implementation" placeholder.
export function TestCaseReferencePage() {
  return (
    <TestCaseDetailLayout tab="reference">
      {({ testCase, variant }) =>
        !variant.referenceBuild && variant.referenceSheet ? (
          <ReferenceSheetView
            testCase={testCase}
            variant={variant}
            referenceSheet={variant.referenceSheet}
          />
        ) : (
          <ReferencePlayable
            referenceBuild={variant.referenceBuild}
            variantName={variant.name}
          />
        )
      }
    </TestCaseDetailLayout>
  );
}
