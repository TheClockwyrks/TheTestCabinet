import { useEffect, useMemo, useRef, useState } from "react";
import type { TestCase } from "../../client/types";
import {
  CATALOG_CATEGORIES,
  categoryOf,
  type CatalogCategory,
} from "../data/testCaseTabs";
import { useTestCaseName } from "../data/useTestCaseName";
import { useTestCases } from "../data/useTestCases";
import type { CatalogSelection } from "./useCatalog";

/** How a case-picking surface opens, and when it may resolve that. */
export interface CaseCategoryOptions {
  /**
   * The case the surface was navigated to (a case's or jam's Run button links
   * with `?slug=…`), or the case an edited record already names. Its presence is
   * what distinguishes "opened for this specific case" — where the type follows
   * the case — from "opened cold", which defaults to the first category.
   */
  navSlug?: string | null;
  /**
   * Whether the navigated-to case is known yet. A form that loads its case
   * asynchronously (the comparison editor) passes `false` until then, so the
   * initial resolution does not fire against a placeholder selection and move it
   * out from under the record being loaded. Defaults to `true`.
   */
  ready?: boolean;
}

/** The type split a case picker renders: the active category, the cases in it,
 *  and the change handler that keeps the two in step. */
export interface CaseCategorySelection {
  /** The category in effect — the user's pick, else the opened-to case's. */
  category: CatalogCategory;
  /** Switch categories, moving the case selection along with it. */
  setCategory: (next: CatalogCategory) => void;
  /** The catalog's cases in that category, sorted by display name. */
  cases: TestCase[];
}

// The **test type → test case** split shared by every surface that picks a case to
// run (the new-run form, the comparison editor). `useCatalog` resolves the case,
// version, and variant; this hook layers the type selector over it — bucketing the
// catalog by the same categories the `/test-cases` page groups under, scoping the
// case dropdown to the chosen one, and keeping the two from disagreeing.
//
// The rule in both directions: switching the type moves the case selection into
// that type (so the version/variant re-resolve for a case the dropdown actually
// shows), and opening on a specific case adopts that case's type.
export function useCaseCategory(
  sel: CatalogSelection,
  options: CaseCategoryOptions = {},
): CaseCategorySelection {
  const { navSlug = null, ready = true } = options;
  const testCaseName = useTestCaseName();
  // The richer catalog (with each case's test type / asset kind) so the type
  // selector can bucket cases; `useCatalog` only carries slugs + versions.
  const { testCases: summaries } = useTestCases();
  const summaryBySlug = useMemo(
    () => new Map(summaries.map((s) => [s.slug, s])),
    [summaries],
  );
  const slugCategory = (slug: string): CatalogCategory | null => {
    const summary = summaryBySlug.get(slug);
    return summary ? categoryOf(summary) : null;
  };

  // The selected category, once the user has picked one. Until then it is derived
  // from the selected case (so opening with a case pre-selected opens on that
  // case's type).
  const [category, setCategory] = useState<CatalogCategory | null>(null);

  // The first case of `target`, by display name — where a category switch lands.
  const firstCaseIn = (target: CatalogCategory): TestCase | undefined =>
    [...sel.cases]
      .filter((c) => slugCategory(c.slug) === target)
      .sort((a, b) =>
        testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
      )[0];

  // The category actually in effect: the user's pick once made, otherwise the
  // opened-to case's category, falling back to the first tab (E2E). Note this
  // derives from `navSlug`, not the auto-selected `sel.slug` — opened cold there
  // is no such case, so it defaults to E2E rather than adopting whatever category
  // the catalog's first case happens to sit in.
  const activeCategory: CatalogCategory =
    category ??
    (navSlug ? slugCategory(navSlug) : null) ??
    CATALOG_CATEGORIES[0]!.value;

  // Choose the initial type + case once the catalog metadata resolves, before the
  // user picks. Opened for a specific case, open on that case's type. Opened cold,
  // default to E2E and lead with its first case — rather than adopting the
  // category of whatever case the catalog happens to list first.
  const initialized = useRef(false);
  useEffect(() => {
    if (!ready || initialized.current || category !== null || !sel.slug) return;
    const currentCategory = slugCategory(sel.slug);
    // Wait until the selected case's catalog metadata has loaded to resolve it.
    if (currentCategory === null) return;
    initialized.current = true;
    if (navSlug) {
      setCategory(currentCategory);
      return;
    }
    const target = CATALOG_CATEGORIES[0]!.value;
    setCategory(target);
    // The auto-selected first case may not be in the default category; move the
    // selection to that category's first case so the case dropdown and the type
    // agree.
    if (currentCategory !== target) {
      const first = firstCaseIn(target);
      if (first) sel.setSlug(first.slug);
    }
    // slugCategory/firstCaseIn close over the catalog; re-run as it resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, category, sel.slug, sel.cases, summaryBySlug, navSlug]);

  // Switching the type moves the case selection into the chosen category (unless
  // the current case already belongs to it) so the version and variant re-resolve
  // for a case the dropdown actually shows.
  function onCategoryChange(next: CatalogCategory) {
    setCategory(next);
    if (slugCategory(sel.slug) === next) return;
    const first = firstCaseIn(next);
    if (first) sel.setSlug(first.slug);
  }

  // The catalog arrives in slug order, but the dropdown labels each option with
  // the display name — so sort by resolved display name to keep the list
  // alphabetical as shown (otherwise e.g. "Carom" slots in where "pong" sits).
  // Scoped to the selected type so the list only offers cases of that category.
  const cases = useMemo(
    () =>
      [...sel.cases]
        .filter((c) => slugCategory(c.slug) === activeCategory)
        .sort((a, b) =>
          testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
        ),
    // slugCategory closes over summaryBySlug; the list depends on it and the category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel.cases, testCaseName, summaryBySlug, activeCategory],
  );

  return { category: activeCategory, setCategory: onCategoryChange, cases };
}
