import { Navigate, useLocation } from "react-router";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import { routes } from "../../../routes";
import { ReferenceSheetView } from "./ReferenceSheetView";

// The Reference tab (`/test-cases/:slug/reference`): the published reference
// FRAMES of an asset-generation variant — the rendered sheet plus the action log
// each frame was drawn from, published to the snapshot bucket. There is nothing
// to embed, so they are rendered natively — see `ReferenceSheetView`.
//
// This tab used to also host an end-to-end / full-stack variant's deployed
// reference BUILD. That embed now lives on the detail landing tab's Play surface
// (beside the showcase carousel), so a coordinate without a `referenceSheet` —
// whether it has builds, or nothing at all — no longer has a Reference tab, and a
// hand-typed URL (or a variant switch to such a coordinate) redirects to the
// landing rather than rendering a duplicate or an empty page. The redirect keeps
// the query string, so the anchored coordinate survives the hop.
export function TestCaseReferencePage() {
  return (
    <TestCaseDetailLayout tab="reference">
      {({ testCase, variant, version }) =>
        variant.referenceSheet ? (
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

// The redirect target for a sheetless coordinate. A component (rather than an
// inline `<Navigate>`) because the current search string is read with a hook,
// and the layout's children prop is a plain render function.
function RedirectToLanding({ slug }: { slug: string }) {
  const { search } = useLocation();
  return (
    <Navigate to={{ pathname: routes.testCaseDetail(slug), search }} replace />
  );
}
