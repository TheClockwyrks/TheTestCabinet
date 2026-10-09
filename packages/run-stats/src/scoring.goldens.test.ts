// The shared scoring goldens, executed against the TypeScript mirror.
//
// Every file under `crates/contracts/fixtures/scoring/` holds the cases one function
// pair must agree on: a Rust function (crates/core/src/review.rs,
// crates/core/src/comparison.rs or crates/contracts/src/test_case.rs) and its mirror
// in `./scoring`. The files are read **directly off the crate**, never copied into this
// package, so a case added on either side is executed by both suites; the Rust half is
// `crates/core/src/review.goldens.test.rs`, and the expectations are its output.
//
// The two halves agree on strictness. The Rust structs are `deny_unknown_fields`, and
// this file rejects unknown keys for the same reason: a misspelled key would fall back
// to its default and leave a case asserting less than it reads as asserting.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DebugScriptResult } from "@clockwyrks/run-record";
import type {
  DomainRating,
  Rating,
  ReviewVerdict,
  VerdictStatus,
} from "@clockwyrks/run-record/review";
import {
  aggregateOverallGrade,
  aggregateRating,
  aggregateScore,
  applyScoreExclusions,
  automatedOnlyScore,
  automatedVerdicts,
  coveredScore,
  gatedOverallGrade,
  gatedRating,
  gatedScore,
  mergeReviewItems,
  scoreChecklist,
  validatorDomainRatings,
  type AggregateScore,
  type GradeStatus,
  type Score,
  type WeightedItem,
} from "./scoring";

/** The golden files' directory, resolved from this file rather than from the working
 *  directory so the suite behaves the same run from the package and from the root. */
const GOLDENS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../crates/contracts/fixtures/scoring",
);

type Json = Record<string, unknown>;

/** Fail when `value` carries a key outside `allowed`, or lacks one in `required`. */
function keys(
  value: unknown,
  where: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Json {
  expect(value, where).toBeTypeOf("object");
  expect(value, where).not.toBeNull();
  const object = value as Json;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(object)) {
    expect(allowed.has(key), `${where}: unknown key \`${key}\``).toBe(true);
  }
  for (const key of required) {
    expect(key in object, `${where}: missing key \`${key}\``).toBe(true);
  }
  return object;
}

const ITEM_KEYS = ["graded", "scored", "failureCap", "domains", "subItems"];
const POINT_KEYS = ["weight", "scored", "failureCap", "domains"];

function checkItems(items: unknown, where: string): void {
  expect(Array.isArray(items), where).toBe(true);
  for (const [i, item] of (items as unknown[]).entries()) {
    const object = keys(item, `${where}[${i}]`, ["id", "weight"], ITEM_KEYS);
    for (const [j, point] of ((object.subItems as unknown[]) ?? []).entries()) {
      keys(point, `${where}[${i}].subItems[${j}]`, ["id"], POINT_KEYS);
    }
  }
}

function checkVerdicts(verdicts: unknown, where: string): void {
  expect(Array.isArray(verdicts), where).toBe(true);
  for (const [i, verdict] of (verdicts as unknown[]).entries()) {
    keys(verdict, `${where}[${i}]`, ["id", "status"]);
  }
}

function checkRated(ratings: unknown, where: string): void {
  expect(Array.isArray(ratings), where).toBe(true);
  for (const [i, rated] of (ratings as unknown[]).entries()) {
    keys(rated, `${where}[${i}]`, ["domain", "rating"]);
  }
}

function checkScore(score: unknown, where: string, aggregate = false): void {
  if (score === null && aggregate) return;
  keys(
    score,
    where,
    aggregate ? ["earned", "total", "reviews"] : ["earned", "total"],
  );
}

function checkScripts(scripts: unknown, where: string): void {
  expect(Array.isArray(scripts), where).toBe(true);
  for (const [i, script] of (scripts as unknown[]).entries()) {
    const object = keys(
      script,
      `${where}[${i}]`,
      ["itemId"],
      ["subItemId", "ran", "preconditionUnmet", "verdicts"],
    );
    for (const [j, verdict] of (
      (object.verdicts as unknown[]) ?? []
    ).entries()) {
      keys(verdict, `${where}[${i}].verdicts[${j}]`, ["id", "pass"]);
    }
  }
}

function checkFigures(figures: unknown, where: string): void {
  const object = keys(figures, where, ["rating", "score", "overallGrade"]);
  checkScore(object.score, `${where}.score`, true);
}

interface Case<I, E> {
  name: string;
  why: string;
  input: I;
  expect: E;
}

/** Read a golden file, check every level's keys with `check`, and return its cases. */
function load<I, E>(
  file: string,
  check: (input: unknown, expected: unknown, where: string) => void,
): Case<I, E>[] {
  const raw = JSON.parse(
    readFileSync(resolve(GOLDENS, `${file}.json`), "utf8"),
  ) as unknown;
  const golden = keys(raw, file, ["$comment", "cases"]);
  expect(golden.$comment).toBeTypeOf("string");
  const cases = golden.cases as unknown[];
  expect(cases.length, file).toBeGreaterThan(0);
  const names = new Set<string>();
  for (const [i, entry] of cases.entries()) {
    const object = keys(entry, `${file}.cases[${i}]`, [
      "name",
      "why",
      "input",
      "expect",
    ]);
    const name = object.name as string;
    expect(names.has(name), `duplicate case \`${name}\``).toBe(false);
    names.add(name);
    expect((object.why as string).trim(), `${name}: why`).not.toBe("");
    check(object.input, object.expect, `${file}: ${name}`);
  }
  return cases as Case<I, E>[];
}

/** A checklist item compared with its defaults filled in, matching the Rust adapter's
 *  `Item`, so an output that leaves a default implicit compares equal to one that
 *  states it. */
function normalized(items: readonly WeightedItem[]) {
  return items.map((item) => ({
    id: item.id,
    weight: item.weight,
    graded: item.graded ?? false,
    scored: item.scored ?? true,
    failureCap: item.failureCap ?? null,
    domains: [...(item.domains ?? [])],
    subItems: (item.subItems ?? []).map((point) => ({
      id: point.id,
      weight: point.weight ?? 1,
      scored: point.scored ?? true,
      failureCap: point.failureCap ?? null,
      domains: [...(point.domains ?? [])],
    })),
  }));
}

interface Script {
  itemId: string;
  subItemId?: string | null;
  ran?: boolean;
  preconditionUnmet?: boolean;
  verdicts?: { id: string; pass: boolean }[];
}

function debugScripts(scripts: readonly Script[]): DebugScriptResult[] {
  return scripts.map((script) => ({
    itemId: script.itemId,
    subItemId: script.subItemId ?? null,
    title: "",
    categoryTitle: "",
    script: "",
    gates: true,
    ran: script.ran ?? true,
    preconditionUnmet: script.preconditionUnmet ?? false,
    inconclusive: null,
    detail: null,
    verdicts: (script.verdicts ?? []).map((v) => ({ ...v, assertions: [] })),
    outputs: [],
  }));
}

const bare = (verdicts: readonly ReviewVerdict[]) =>
  verdicts.map(({ id, status }) => ({ id, status }));

interface Figures {
  rating: Rating | null;
  score: AggregateScore | null;
  overallGrade: GradeStatus | null;
}

describe("the scoring goldens", () => {
  describe("score_checklist", () => {
    const cases = load<
      { items: WeightedItem[]; checklist: ReviewVerdict[] },
      Score
    >("score_checklist", (input, expected, where) => {
      const object = keys(input, `${where}: input`, ["items", "checklist"]);
      checkItems(object.items, `${where}: items`);
      checkVerdicts(object.checklist, `${where}: checklist`);
      checkScore(expected, `${where}: expect`);
    });
    it.each(cases)("$name", ({ input, expect: expected }) => {
      expect(scoreChecklist(input.items, input.checklist)).toEqual(expected);
    });
  });

  describe("gated", () => {
    const cases = load<{ gated: boolean; reviewed: Figures }, Figures>(
      "gated",
      (input, expected, where) => {
        const object = keys(input, `${where}: input`, ["gated", "reviewed"]);
        checkFigures(object.reviewed, `${where}: reviewed`);
        checkFigures(expected, `${where}: expect`);
      },
    );
    it.each(cases)("$name", ({ input, expect: expected }) => {
      const { gated, reviewed } = input;
      expect({
        rating: gatedRating(gated, reviewed.rating),
        score: gatedScore(gated, reviewed.score),
        overallGrade: gatedOverallGrade(gated, reviewed.overallGrade),
      }).toEqual(expected);
    });
  });

  describe("aggregate", () => {
    const cases = load<
      {
        scores: Score[];
        ratings: DomainRating[][];
        checklists: ReviewVerdict[][];
      },
      Figures
    >("aggregate", (input, expected, where) => {
      const object = keys(input, `${where}: input`, [
        "scores",
        "ratings",
        "checklists",
      ]);
      for (const [i, score] of (object.scores as unknown[]).entries()) {
        checkScore(score, `${where}: scores[${i}]`);
      }
      for (const [i, review] of (object.ratings as unknown[]).entries()) {
        checkRated(review, `${where}: ratings[${i}]`);
      }
      for (const [i, checklist] of (object.checklists as unknown[]).entries()) {
        checkVerdicts(checklist, `${where}: checklists[${i}]`);
      }
      checkFigures(expected, `${where}: expect`);
    });
    it.each(cases)("$name", ({ input, expect: expected }) => {
      expect({
        rating: aggregateRating(input.ratings),
        score: aggregateScore(input.scores),
        overallGrade: aggregateOverallGrade(input.checklists),
      }).toEqual(expected);
    });
  });

  describe("validator_domain", () => {
    const cases = load<
      { domains: string[]; items: WeightedItem[]; debugScripts: Script[] },
      DomainRating[]
    >("validator_domain", (input, expected, where) => {
      const object = keys(input, `${where}: input`, [
        "domains",
        "items",
        "debugScripts",
      ]);
      checkItems(object.items, `${where}: items`);
      checkScripts(object.debugScripts, `${where}: debugScripts`);
      checkRated(expected, `${where}: expect`);
    });
    it.each(cases)("$name", ({ input, expect: expected }) => {
      const domains = input.domains.map((id) => ({ id }));
      expect(
        validatorDomainRatings(
          domains,
          input.items,
          debugScripts(input.debugScripts),
        ),
      ).toEqual(expected);
    });
  });

  describe("merge_review_items", () => {
    const cases = load<
      { common: WeightedItem[]; variant: WeightedItem[] },
      WeightedItem[]
    >("merge_review_items", (input, expected, where) => {
      const object = keys(input, `${where}: input`, ["common", "variant"]);
      checkItems(object.common, `${where}: common`);
      checkItems(object.variant, `${where}: variant`);
      checkItems(expected, `${where}: expect`);
    });
    it.each(cases)("$name", ({ input, expect: expected }) => {
      expect(normalized(mergeReviewItems(input.common, input.variant))).toEqual(
        normalized(expected),
      );
    });
  });

  describe("score_exclusions", () => {
    const cases = load<
      { items: WeightedItem[]; excluded: string[] },
      WeightedItem[]
    >("score_exclusions", (input, expected, where) => {
      const object = keys(input, `${where}: input`, ["items", "excluded"]);
      checkItems(object.items, `${where}: items`);
      checkItems(expected, `${where}: expect`);
    });
    it.each(cases)("$name", ({ input, expect: expected }) => {
      expect(
        normalized(applyScoreExclusions(input.items, new Set(input.excluded))),
      ).toEqual(normalized(expected));
    });
  });

  describe("automated", () => {
    const cases = load<
      {
        items: WeightedItem[];
        debugScripts: Script[];
        verdicts: ReviewVerdict[];
      },
      {
        automatedVerdicts: { id: string; status: VerdictStatus }[];
        automatedOnlyScore: Score;
        coveredScore: Score;
      }
    >("automated", (input, expected, where) => {
      const object = keys(input, `${where}: input`, [
        "items",
        "debugScripts",
        "verdicts",
      ]);
      checkItems(object.items, `${where}: items`);
      checkScripts(object.debugScripts, `${where}: debugScripts`);
      checkVerdicts(object.verdicts, `${where}: verdicts`);
      const out = keys(expected, `${where}: expect`, [
        "automatedVerdicts",
        "automatedOnlyScore",
        "coveredScore",
      ]);
      checkVerdicts(out.automatedVerdicts, `${where}: automatedVerdicts`);
      checkScore(out.automatedOnlyScore, `${where}: automatedOnlyScore`);
      checkScore(out.coveredScore, `${where}: coveredScore`);
    });
    it.each(cases)("$name", ({ input, expect: expected }) => {
      const scripts = debugScripts(input.debugScripts);
      expect({
        automatedVerdicts: bare(automatedVerdicts(scripts)),
        automatedOnlyScore: automatedOnlyScore(input.items, scripts),
        coveredScore: coveredScore(input.items, input.verdicts),
      }).toEqual(expected);
    });
  });
});
