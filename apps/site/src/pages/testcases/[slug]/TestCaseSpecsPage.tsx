import type { ComponentType } from "react";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import { useDesignVariant } from "./design/DesignVariantContext";
import type { DesignVariant, SpecsViewProps } from "./design/types";
import { RefinedSpecs } from "./design/specs/RefinedSpecs";
import { DocumentSpecs } from "./design/specs/DocumentSpecs";
import { AccordionSpecs } from "./design/specs/AccordionSpecs";
import { DeckSpecs } from "./design/specs/DeckSpecs";

// Maps the active design to the Specifications body. This is where the four
// directions diverge most — the tab the redesign is really about:
//   refined  — today's two-pane file browser (tree + file pane).
//   document — one scrolling document with a sticky outline.
//   rail     — a stack of collapsible file panels beside the console rail.
//   deck     — editor-style file tabs over a framed screen, with a screenshot
//              filmstrip.
const SPECS_VIEWS: Record<DesignVariant, ComponentType<SpecsViewProps>> = {
  refined: RefinedSpecs,
  document: DocumentSpecs,
  rail: AccordionSpecs,
  deck: DeckSpecs,
};

// The Specifications tab (`/test-cases/:slug/specs`): the exact files a run of the
// selected variant is seeded with — the same set `tcab seed --variant <slug>`
// materializes. Which design renders them is chosen by the page-level design
// switcher; the body remounts per variant so any per-file selection resets.
export function TestCaseSpecsPage() {
  const { design } = useDesignVariant();
  const SpecsView = SPECS_VIEWS[design];

  return (
    <TestCaseDetailLayout tab="specs">
      {({ testCase, variant }) => (
        <SpecsView key={variant.slug} testCase={testCase} variant={variant} />
      )}
    </TestCaseDetailLayout>
  );
}
