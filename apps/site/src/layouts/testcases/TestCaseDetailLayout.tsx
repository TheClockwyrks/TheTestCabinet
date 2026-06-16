import type { ComponentType, ReactNode } from "react";
import { useParams } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { useTestCases } from "../../data/useTestCases";
import type { TestCaseSummary, VariantSummary } from "../../data/testCases";
import { useSelectedVariant } from "../../pages/testcases/[slug]/useSelectedVariant";
import { useDesignVariant } from "../../pages/testcases/[slug]/design/DesignVariantContext";
import { DesignSwitcher } from "../../pages/testcases/[slug]/design/DesignSwitcher";
import type {
  DesignVariant,
  DetailShellProps,
  DetailTab,
} from "../../pages/testcases/[slug]/design/types";
import { HorizontalShell } from "../../pages/testcases/[slug]/design/shells/HorizontalShell";
import { RailShell } from "../../pages/testcases/[slug]/design/shells/RailShell";
import { DeckShell } from "../../pages/testcases/[slug]/design/shells/DeckShell";
import styles from "./TestCaseDetailLayout.module.scss";

export type { DetailTab };

// Maps the active design to the shell that renders the page chrome. The "refined"
// and "document" designs share the horizontal-tab chrome and differ only in their
// Specifications body (chosen in `TestCaseSpecsPage`).
const SHELLS: Record<DesignVariant, ComponentType<DetailShellProps>> = {
  refined: HorizontalShell,
  document: HorizontalShell,
  rail: RailShell,
  deck: DeckShell,
};

interface TestCaseDetailLayoutProps {
  /** Which tab the rendering page represents. */
  tab: DetailTab;
  /** The tab body, given the resolved case and the selected variant. */
  children: (ctx: {
    testCase: TestCaseSummary;
    variant: VariantSummary;
  }) => ReactNode;
}

// Shared chrome for every test-case detail tab. It resolves the case from the URL
// slug and the variant from the query string, then hands both to the active tab's
// body and to the design shell that frames it. The shell is chosen by the
// design-variant switcher (a floating exploration control rendered here), so every
// tab — and every page that mounts this layout — switches design together.
export function TestCaseDetailLayout({
  tab,
  children,
}: TestCaseDetailLayoutProps) {
  const { slug } = useParams<{ slug: string }>();
  const { testCases } = useTestCases();
  const { design } = useDesignVariant();
  const testCase = testCases.find((entry) => entry.slug === slug);
  // Called unconditionally (hook rules); it tolerates an undefined case and
  // simply resolves no variant, which the guard below turns into the not-found
  // state.
  const [variant, setVariant] = useSelectedVariant(testCase);

  if (!testCase || !variant) {
    return (
      <PageLayout>
        <p className={styles.notFound}>
          No test case found for &ldquo;{slug}&rdquo;.
        </p>
        <DesignSwitcher />
      </PageLayout>
    );
  }

  const Shell = SHELLS[design];

  return (
    <PageLayout>
      <Shell
        testCase={testCase}
        variant={variant}
        setVariant={setVariant}
        tab={tab}
      >
        {children({ testCase, variant })}
      </Shell>
      <DesignSwitcher />
    </PageLayout>
  );
}
