import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { TestType } from "@test-cabinet/run-record";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { SegmentedControl } from "../../../primitives/SegmentedControl";
import type { SegmentedOption } from "../../../primitives/SegmentedControl";
import { useTestCases } from "../../data/useTestCases";
import type { TestCaseSummary } from "../../data/testCases";
import { routes } from "../../routes";
import styles from "./TestCasesPage.module.scss";

// The test-type switcher: one segment per test type, always shown in this order
// so the control's shape is stable regardless of which types the catalog
// currently holds. The catalog shows exactly one type at a time.
const TYPE_OPTIONS: ReadonlyArray<SegmentedOption<TestType>> = [
  { value: "end-to-end", label: "E2E" },
  { value: "asset-generation", label: "Asset" },
  { value: "adversarial", label: "Adversarial" },
  { value: "performance", label: "Performance" },
];

// The test-case catalog: every case as a neon card showing its title and a
// short summary. A sliding type switcher scopes the grid to a single test type,
// and a client-side search narrows by title within it. Cards link to the
// per-slug detail page and are listed alphabetically — never ranked.
export function TestCasesPage() {
  const { testCases, status } = useTestCases();
  const [query, setQuery] = useState("");
  const [testType, setTestType] = useState<TestType>("end-to-end");

  const shown = useMemo(
    () =>
      testCases
        .filter((testCase) => matches(testCase, query, testType))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [testCases, query, testType],
  );

  return (
    <PageLayout>
      <PromptHeader
        command="--test-cases"
        blink
        comment={<>// the specs harnesses build against</>}
      />

      {status === "loading" && <p className={styles.empty}>Loading catalog…</p>}

      {status === "error" && (
        <p className={styles.error}>
          Couldn&apos;t reach the backend — the test-case catalog is
          unavailable.
        </p>
      )}

      {status === "ready" && (
        <>
          <div className={styles.controls}>
            <SegmentedControl
              options={TYPE_OPTIONS}
              value={testType}
              onChange={setTestType}
              ariaLabel="Test type"
            />
            <input
              className={styles.search}
              type="search"
              placeholder="Search by title, tag, or difficulty…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search test cases"
            />
          </div>

          {shown.length === 0 ? (
            <p className={styles.empty}>No test cases match.</p>
          ) : (
            <ul className={styles.grid}>
              {shown.map((testCase) => (
                <li key={testCase.slug}>
                  <Link
                    to={routes.testCaseDetail(testCase.slug)}
                    className={styles.card}
                  >
                    <div className={styles.cardHeader}>
                      <h2 className={styles.cardTitle}>{testCase.name}</h2>
                      <span
                        className={styles.difficulty}
                        data-level={testCase.difficulty}
                      >
                        {testCase.difficulty}
                      </span>
                    </div>
                    {testCase.summary && (
                      <p className={styles.summary}>{testCase.summary}</p>
                    )}
                    {testCase.tags.length > 0 && (
                      <ul className={styles.tags}>
                        {testCase.tags.map((value) => (
                          <li key={value} className={styles.tag}>
                            {value}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PageLayout>
  );
}

// Scope to the selected test type, then a case-insensitive search over the
// title, tags, and difficulty — so tags and difficulty are usable as filters
// even though the type switcher is the only faceted control.
function matches(
  testCase: TestCaseSummary,
  query: string,
  testType: TestType,
): boolean {
  if (testCase.testType !== testType) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [testCase.name, testCase.difficulty, ...testCase.tags]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}
