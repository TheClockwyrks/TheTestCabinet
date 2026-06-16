import { useMemo, useState } from "react";
import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { useTestCases } from "../../data/useTestCases";
import type { TestCaseSummary } from "../../data/testCases";
import { routes } from "../../routes";
import styles from "./TestCasesPage.module.scss";

// The test-case catalog: every case as a neon card showing its title and
// difficulty on one row, a short summary, and its tags, with a client-side
// search (title/tag) and difficulty/tag filters. Cards link to the per-slug
// detail page. The catalog is not a leaderboard — cases are listed, never ranked.
export function TestCasesPage() {
  const { testCases } = useTestCases();
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);

  // The filter vocabularies, derived once from the catalog so the controls
  // only ever offer values that actually appear.
  const difficulties = useMemo(
    () => unique(testCases.map((testCase) => testCase.difficulty)),
    [testCases],
  );
  const tags = useMemo(
    () => unique(testCases.flatMap((testCase) => testCase.tags)),
    [testCases],
  );

  const shown = useMemo(
    () => testCases.filter((testCase) => matches(testCase, query, difficulty, tag)),
    [testCases, query, difficulty, tag],
  );

  return (
    <PageLayout>
      <header className={styles.header}>
        <h1 className={styles.title}>Test Cases</h1>
        <p className={styles.lede}>
          The specs harnesses build against. Every case is seeded into a fresh
          repository exactly as shown — nothing is ranked here.
        </p>
      </header>

      <div className={styles.controls}>
        <input
          className={styles.search}
          type="search"
          placeholder="Search by title or tag…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search test cases"
        />
        <FilterRow label="Difficulty" active={difficulty} onClear={() => setDifficulty(null)}>
          {difficulties.map((value) => (
            <FilterChip
              key={value}
              label={value}
              active={difficulty === value}
              onClick={() => setDifficulty(difficulty === value ? null : value)}
            />
          ))}
        </FilterRow>
        <FilterRow label="Tags" active={tag} onClear={() => setTag(null)}>
          {tags.map((value) => (
            <FilterChip
              key={value}
              label={value}
              active={tag === value}
              onClick={() => setTag(tag === value ? null : value)}
            />
          ))}
        </FilterRow>
      </div>

      {shown.length === 0 ? (
        <p className={styles.empty}>No test cases match those filters.</p>
      ) : (
        <ul className={styles.grid}>
          {shown.map((testCase) => (
            <li key={testCase.slug}>
              <Link to={routes.testCaseDetail(testCase.slug)} className={styles.card}>
                <div className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>{testCase.name}</h2>
                  <span className={styles.difficulty} data-level={testCase.difficulty}>
                    {testCase.difficulty}
                  </span>
                </div>
                {testCase.summary && <p className={styles.summary}>{testCase.summary}</p>}
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
    </PageLayout>
  );
}

// Case-insensitive search over title + tags, AND'd with the active
// difficulty/tag facets.
function matches(
  testCase: TestCaseSummary,
  query: string,
  difficulty: string | null,
  tag: string | null,
): boolean {
  if (difficulty && testCase.difficulty !== difficulty) return false;
  if (tag && !testCase.tags.includes(tag)) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [testCase.name, ...testCase.tags].join(" ").toLowerCase();
  return haystack.includes(needle);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

interface FilterRowProps {
  label: string;
  active: string | null;
  onClear: () => void;
  children: React.ReactNode;
}

function FilterRow({ label, active, onClear, children }: FilterRowProps) {
  return (
    <div className={styles.filterRow}>
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.chips}>
        {children}
        {active && (
          <button type="button" className={styles.clear} onClick={onClear}>
            clear
          </button>
        )}
      </div>
    </div>
  );
}

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      className={`${styles.chip}${active ? ` ${styles.chipActive}` : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
