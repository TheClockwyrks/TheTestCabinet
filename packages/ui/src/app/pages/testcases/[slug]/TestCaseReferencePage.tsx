import { Navigate, useLocation } from "react-router";
import { hasReferencePlayback } from "../../../data/testCaseReference";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import { routes } from "../../../routes";
import { ReferencePlaybackView } from "./ReferencePlaybackView";
import { ReferenceSheetView } from "./ReferenceSheetView";

// The Reference tab (`/test-cases/:slug/reference`): the authored, in-repo,
// versioned *correct* answer for the selected coordinate. What that is depends on
// what the case produces, so this tab renders one of two things:
//
//   • An asset-generation variant's reference is *data*, not a page: the published
//     reference FRAMES plus the action log each frame was drawn from, published to
//     the snapshot bucket. There is nothing to embed, so they are rendered natively
//     — see `ReferenceSheetView`.
//   • A performance case produces neither a page nor an image but an ENGINE, so its
//     reference is what the authoritative engine does: the scored factories, played
//     in the browser through the vendored `lattice-core` wasm — see
//     `ReferencePlaybackView`.
//
// A case carries at most one of the two in practice (a case is a single test type),
// so the branches are a genuine either/or rather than a precedence decision. The
// playback is checked first because it is the only one keyed off the CASE rather
// than the selected variant — it ships with the bundle, so it needs no per-variant
// signal.
//
// This tab used to also host an end-to-end / full-stack variant's deployed
// reference BUILD. That embed now lives on the detail landing tab's Play surface
// (beside the showcase carousel), so a coordinate with neither playback nor a
// `referenceSheet` — whether it has builds, or nothing at all — no longer has a
// Reference tab, and a hand-typed URL (or a variant switch to such a coordinate)
// redirects to the landing rather than rendering a duplicate or an empty page. The
// redirect keeps the query string, so the anchored coordinate survives the hop.
export function TestCaseReferencePage() {
  return (
    <TestCaseDetailLayout tab="reference">
      {({ testCase, variant, version }) =>
        hasReferencePlayback(testCase) ? (
          <ReferencePlaybackView />
        ) : variant.referenceSheet ? (
          <ReferenceSheetView
            testCase={testCase}
            version={version}
            variant={variant}
            referenceSheet={variant.referenceSheet}
          />
        ) : (
          <RedirectToLanding slug={testCase.slug} />
        )
      }
    </TestCaseDetailLayout>
  );
}

// The redirect target for a coordinate with no reference of its own. A component
// (rather than an inline `<Navigate>`) because the current search string is read
// with a hook, and the layout's children prop is a plain render function.
function RedirectToLanding({ slug }: { slug: string }) {
  const { search } = useLocation();
  return (
    <Navigate to={{ pathname: routes.testCaseDetail(slug), search }} replace />
  );
}
