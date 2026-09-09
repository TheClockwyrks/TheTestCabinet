// Wick — the suite's assertions. CASE-PROVIDED, over the shared harness.
//
// The assertions themselves are the shared validator harness's
// (`@clockwyrks/case-harness`), because what they are FOR is the runner's
// contract rather than this case's: the runner stores each failed check as an
// expected/actual pair and the console renders that pair to the reviewer, so
// every check in every validator project throws a message of exactly the shape
// the runner extracts —
//
//   Expected: at most 8
//   Actual: 9.097252332435328
//
// A case that wrote its own set would be restating that contract, and a case
// that drifted from it would report a verdict the console could not render.
//
// Every helper takes an optional trailing `context`: what a check that runs the
// same comparison many times over says to tell one failure from another
// (`moth 2 on tick 31: hp`), or what a harness reading names as the requirement
// the build missed. It lands on the `Expected:` line, after the bound, in
// parentheses:
//
//   Expected: within 1e-9 of 5.75 (moth 2 on tick 31: hp)
//   Actual: 5
//
// so the pair stays two lines and the runner still reads it as one.
//
// THREE ARE THIS PROJECT'S OWN, and each is a reading the package does not
// carry rather than a second spelling of one it does. They are declared below,
// and the two private helpers they need — the `Expected:` phrase and the
// one-line rendering of a value — are written out here rather than imported,
// because the package exports neither: `fail` is its whole public seam, and
// both helpers are three lines.
//
// This file stays because the suites next door say `from "../assert"`, and that
// is the right thing for them to say: an assertion is the vocabulary a check
// states its verdict in, not a package a check depends on.

import { fail } from "./case-harness/assert";

export * from "./case-harness/assert";

/** The `Expected:` phrase, with the check's own context after it when it gave one. */
function phrase(expected: string, context?: string): string {
  return context === undefined ? expected : `${expected} (${context})`;
}

/** A value rendered for a failure message, on one line. */
function show(value: unknown): string {
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Structural equality over the JSON-shaped values the suites compare. Leaves
 * are read as the shared `assertEqual` reads them: by `Object.is`, with `+0`
 * and `-0` the same value, since a figure a build reached as negative zero is
 * the `0` a specification states.
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b) || (a === 0 && b === 0)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, i) => deepEquals(item, b[i]))
    );
  }
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null ||
    Array.isArray(a) ||
    Array.isArray(b)
  ) {
    return false;
  }
  const left = Object.entries(a as Record<string, unknown>);
  const right = Object.entries(b as Record<string, unknown>);
  return (
    left.length === right.length &&
    left.every(
      ([key, value]) =>
        key in b && deepEquals(value, (b as Record<string, unknown>)[key]),
    )
  );
}

/**
 * `actual` is within `tolerance` of `expected`, both ends in — the reading
 * every real-valued figure in this case is compared by, with the tolerance
 * named in `constants.ts` beside the reason it is honest. Two equal
 * infinities are within any tolerance; nothing else infinite is.
 *
 * A DIFFERENT NAME AND A DIFFERENT READING FROM THE PACKAGE'S `assertNear`,
 * which this project therefore does not shadow. That one fails any non-finite
 * `actual` outright and phrases its bound `E +/- T`; this one lets two equal
 * infinities through and phrases it `within T of E`. Every one of this
 * project's eight hundred-odd real-valued comparisons was written against this
 * wording, and both readings ship under names that say which is which.
 */
export function assertWithin(
  actual: number,
  expected: number,
  tolerance: number,
  context?: string,
): void {
  if (actual === expected) return;
  if (!(Math.abs(actual - expected) <= tolerance)) {
    fail(phrase(`within ${tolerance} of ${expected}`, context), actual);
  }
}

/** `actual` and `unwanted` differ somewhere (JSON-comparable values). */
export function assertNotDeepEqual(
  actual: unknown,
  unwanted: unknown,
  context?: string,
): void {
  if (deepEquals(actual, unwanted)) {
    fail(phrase(`a value other than ${show(unwanted)}`, context), actual);
  }
}

/**
 * `condition` is `false`.
 *
 * The package carries `assertTrue` and `assertTruthy` and no negative of
 * either, so this stays with the case: a check that reads "the build did NOT
 * open the overlay" states that directly rather than as `assertEqual(x, false)`,
 * whose failure pair would name the value twice over.
 */
export function assertFalse(condition: boolean, context?: string): void {
  if (condition) fail(phrase("false", context), condition);
}

/** A string does not contain `needle`, or an array holds no equal element. */
export function assertNotContains(
  container: string | readonly unknown[],
  needle: unknown,
  context?: string,
): void {
  const holds =
    typeof container === "string"
      ? typeof needle === "string" && container.includes(needle)
      : container.some((item) => deepEquals(item, needle));
  if (holds) fail(phrase(`not containing ${show(needle)}`, context), container);
}
