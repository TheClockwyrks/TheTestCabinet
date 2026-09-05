// The **shared conformance suite** — the TypeScript half of the mirrored evaluator's
// only defence.
//
// It reads `crates/core/src/gg_query.conformance.json` **directly off the crate**, not a
// copy vendored into this package. A copy would be worse than no fixture at all: it
// would drift silently, keep passing, and still look like protection. Reading the one
// file means a case added on either side is executed by both suites or neither, and the
// Rust suite (`crates/core/src/gg_query.test.rs`) asserts the same expectations against
// the authoritative implementation.
//
// The two halves also agree on strictness. The Rust structs are `deny_unknown_fields`
// because every assertion is optional, so a misspelled expectation key would degrade a
// case to a bare count check and leave the suite green. This file rejects unknown keys
// for the same reason.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  GgAggColumn,
  GgBucket,
  GgFieldCatalog,
  GgQuery,
  GgRunDoc,
} from "@clockwyrks/run-record/gg-query";
import { evaluate, fieldCatalog } from "./evaluate";

/** One case: a query and what it must produce. */
interface ConformanceCase {
  name: string;
  /** Why the case exists, so a future reader deleting it has to argue with the reason
   *  rather than with an opaque assertion. */
  why: string;
  /** A corpus for **this case only**, replacing the shared one — see the Rust twin's
   *  `ConformanceCase::documents` for why a handful of rules need one. */
  documents?: GgRunDoc[];
  query: GgQuery;
  expect: {
    totalRuns: number;
    truncated?: boolean;
    /** Document queries assert the **ids in order** — the ordering is the property under
     *  test, and repeating six full documents per case would bury it. */
    documentIds?: string[];
    buckets?: GgBucket[];
    columns?: GgAggColumn[];
  };
}

interface Conformance {
  $comment: string;
  documents: GgRunDoc[];
  fieldCatalog: GgFieldCatalog;
  cases: ConformanceCase[];
}

/** The fixture's path, resolved from this file rather than from the working directory so
 *  the suite behaves the same run from `packages/ui` and from the repo root. */
const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../crates/core/src/gg_query.conformance.json",
);

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Conformance;

/** The keys each fixture level may carry. A key outside these lists is a typo that would
 *  otherwise be silently ignored — the exact failure `deny_unknown_fields` exists to
 *  stop on the Rust side. */
const CASE_KEYS = new Set(["name", "why", "documents", "query", "expect"]);
const EXPECT_KEYS = new Set([
  "totalRuns",
  "truncated",
  "documentIds",
  "buckets",
  "columns",
]);

describe("the TCQ conformance fixture", () => {
  it("is the crate's own file, with the shape both suites read", () => {
    expect(fixture.documents.length).toBeGreaterThan(0);
    expect(fixture.cases.length).toBeGreaterThan(0);
    for (const testCase of fixture.cases) {
      for (const key of Object.keys(testCase)) {
        expect(CASE_KEYS.has(key), `unknown key ${key} on case ${testCase.name}`).toBe(
          true,
        );
      }
      for (const key of Object.keys(testCase.expect)) {
        expect(
          EXPECT_KEYS.has(key),
          `unknown expectation key ${key} on case ${testCase.name}`,
        ).toBe(true);
      }
      // A case that asserts nothing but a run count is not pinning an evaluator rule,
      // and it is exactly what a typo'd expectation key degrades into.
      expect(
        testCase.expect.documentIds !== undefined ||
          testCase.expect.buckets !== undefined ||
          testCase.expect.columns !== undefined,
        `${testCase.name}: a case must assert documents, buckets or columns`,
      ).toBe(true);
      expect(testCase.why.length, `${testCase.name}: every case states why`).toBeGreaterThan(0);
    }
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))(
    "%s",
    (_name, testCase) => {
      const actual = evaluate(
        testCase.documents ?? fixture.documents,
        testCase.query,
      );
      expect(actual.totalRuns).toBe(testCase.expect.totalRuns);
      expect(actual.truncated).toBe(testCase.expect.truncated ?? false);
      if (testCase.expect.documentIds) {
        const ids = (actual.documents ?? []).map((doc) => doc.fields.id);
        expect(ids).toEqual(testCase.expect.documentIds);
      }
      if (testCase.expect.buckets) {
        expect(actual.buckets).toEqual(testCase.expect.buckets);
      }
      if (testCase.expect.columns) {
        expect(actual.columns).toEqual(testCase.expect.columns);
      }
    },
  );

  it("pins the field catalog — the second mirrored function", () => {
    // A drift here is a one-host-only autocomplete regression, which is far harder to
    // notice than a wrong number: the console would offer a field the public site does
    // not, and nothing would look broken on either.
    expect(fieldCatalog(fixture.documents)).toEqual(fixture.fieldCatalog);
  });

  it("still covers every hazard the design named", () => {
    // The fixture is the *only* defence against mirrored drift, so a case being deleted
    // has to be as loud as a rule changing. Kept in step with the Rust suite's list.
    const names = fixture.cases.map((c) => c.name);
    for (const needle of [
      "absent field fails !=",
      "not is the only way",
      "total cap.* projection",
      "sparse tool.*",
      "glob",
      "open-ended range",
      "n=1",
      "n=2",
      "n=3",
      "n=4",
      "day histogram",
      "week histogram",
      "Unicode code point",
      "absent value last",
      "code point too",
      "mixed value kinds",
      "backtracks",
      "composite bucket key",
      "free text ignores numbers",
      "coerces to a number",
      "projects to 1 in a comparison",
      "min and max",
      // The hazards the mutation audit found the fixture could not discriminate: every
      // rule below survived a deliberate break of this evaluator with all thirty-two of
      // the cases above still green.
      "later bucket is larger",
      "pre-1970",
      "below its own origin",
      "aggregation column orders buckets",
      "aliased to the same name",
      "truncates buckets",
      "fourth group key",
      "trailing star",
      "byte-order mark",
      // The hazards the **publishable** `code.*` namespace brought: a derived scalar
      // standing in for an array, the composable truncation filter (whose absent-field
      // reading is the easy one to get backwards), and the presence marker every code
      // rate is scoped on. These are the fields the public site ships, so a divergence
      // here is a wrong number on the open internet rather than in a console.
      "code.language groups",
      "not code.notes.truncated",
      "has.codeAnalysis",
    ]) {
      expect(
        names.some((name) => name.includes(needle)),
        `the conformance fixture lost its ${JSON.stringify(needle)} case`,
      ).toBe(true);
    }
  });
});
