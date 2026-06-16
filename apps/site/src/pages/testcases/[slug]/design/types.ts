import type { ReactNode } from "react";
import type { TestCaseSummary, VariantSummary } from "../../../../data/testCases";

// The detail page's three tabs. Each is a distinct route; this drives which tab
// link reads as active in every design shell.
export type DetailTab = "overview" | "specs" | "runs";

// The four design directions this exploration offers for the test-case detail
// page. A floating switcher flips the active one (see `DesignSwitcher`); the
// chosen design picks both the page chrome (a "shell") and the Specifications
// body (a "specs view").
//
//   refined  — the current layout, lightly polished (the "small tweaks" path).
//   document — the current chrome, but Specifications reframed as one scrolling
//              document with a sticky outline (the "only rework Specifications"
//              path).
//   rail     — a full structural rework: a vertical console rail instead of the
//              horizontal tab strip.
//   deck     — a cartridge/editor direction: boxed segmented tabs and an
//              editor-style file deck for Specifications.
export type DesignVariant = "refined" | "document" | "rail" | "deck";

// Props every design shell receives: the resolved case and selected variant,
// the variant setter (the selector lives inside the shell so each design can
// place it differently), which tab is active, and the already-resolved tab body.
export interface DetailShellProps {
  testCase: TestCaseSummary;
  variant: VariantSummary;
  setVariant: (slug: string) => void;
  tab: DetailTab;
  children: ReactNode;
}

// Props every Specifications view receives: the case (for copy) and the variant
// whose seeded files it renders.
export interface SpecsViewProps {
  testCase: TestCaseSummary;
  variant: VariantSummary;
}
