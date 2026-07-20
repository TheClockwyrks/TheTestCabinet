// The reporter-side assertion kit handed to a validation script as the second
// argument of its `drive(api, ttc)` — the "The Test Cabinet" handle. It is the
// single source of truth for what an assertion is and the matchers a script uses
// to record one, so no test case ever copies these primitives into its own
// `validation/_helpers.mjs`.
//
// It is deliberately *not* part of the model's debug `api` (`window.<handle>`):
// that surface is the model's own contract, implemented by the produced build,
// whereas this kit is reporter-side machinery the driver constructs and injects.
// It is never seeded into the model's run container.
//
// A script drives exactly one verdict, so it opens one `check`:
//
//   export default async function drive(api, ttc) {
//     const check = ttc.checkOne("gameplay.match-win");
//     const end = await driveGoal(api, "right");
//     check.expectEq("match screen after match point", end.screen, "matchover");
//     check.expectClose("final p1 score", end.score.p1, 11, 0);
//     return check.verdict();
//   }
//
// Every matcher records one assertion — both the ones that hold and the ones that
// fail are kept (the googletest-`EXPECT` behavior) — so the reviewer sees the full
// proof. Each comparison matcher captures the observed and required values, so a
// FAILING assertion carries `expected`/`actual` for the UI to show; the label alone
// no longer has to bake the value in.
//
// Each matcher comes in two forms:
//   * `expect<Op>` — record and CONTINUE (a soft check; collect every failure).
//   * `assert<Op>` — record and, on failure, STOP the script (a hard check): it
//     throws a `TtcVerdictStop` carrying the verdict decided so far. The driver
//     unwinds that into a normal FAILED verdict (`pass:false`) — not a build
//     conformance error — because the `check` already knows which verdict it backs.

/**
 * Format a value for the `expected`/`actual` display: a string as-is, other
 * primitives via `String`, and anything structured as compact JSON (falling back
 * to `String` if it cannot be serialized, e.g. a cycle). Kept total so a matcher
 * never throws while recording.
 */
function formatValue(value) {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Thrown by a hard `assert<Op>` whose check failed, to abort the script early. It
 * carries the verdict the `check` had decided at the point of failure (its verdict
 * id keyed to the assertions recorded so far), so the driver can unwind it into a
 * completed — failed — verdict rather than mistaking it for a build that never
 * conformed to the debug-API contract.
 */
export class TtcVerdictStop extends Error {
  constructor(verdicts) {
    super("validation stopped by a failed hard assertion");
    this.name = "TtcVerdictStop";
    /** The `{ [verdictId]: assertions }` map the driver records verbatim. */
    this.ttcVerdicts = verdicts;
  }
}

// The comparison matchers, by short op name. Each takes the observed `actual` and
// the required operand(s) and returns `[pass, expected, actual]` — `expected` is a
// human-readable statement of what was required (so a `>` or `±` check reads right),
// and both are `undefined` for a bare boolean (`ok`), which has no value pair to show.
const COMPARATORS = {
  eq: (actual, expected) => [Object.is(actual, expected), expected, actual],
  ne: (actual, unexpected) => [
    !Object.is(actual, unexpected),
    `not ${formatValue(unexpected)}`,
    actual,
  ],
  gt: (actual, bound) => [actual > bound, `> ${formatValue(bound)}`, actual],
  ge: (actual, bound) => [actual >= bound, `>= ${formatValue(bound)}`, actual],
  lt: (actual, bound) => [actual < bound, `< ${formatValue(bound)}`, actual],
  le: (actual, bound) => [actual <= bound, `<= ${formatValue(bound)}`, actual],
  close: (actual, expected, tolerance = 1e-6) => [
    Math.abs(actual - expected) <= tolerance,
    `${formatValue(expected)} ± ${formatValue(tolerance)}`,
    actual,
  ],
  // A bare boolean fact: no value pair, so `expected`/`actual` stay unset and the
  // reviewer sees only the label (there is nothing to show on failure but the claim).
  ok: (condition) => [Boolean(condition), undefined, undefined],
};

/**
 * Open a `check` bound to a single verdict id. It accumulates the assertions a
 * script records and hands them back as a verdict:
 *
 *   * `expect<Op>(label, actual, …operand)` — record the fact and return whether it
 *     held; keep going regardless (collect every failure).
 *   * `assert<Op>(label, actual, …operand)` — record it and, on failure, throw a
 *     [`TtcVerdictStop`] to stop the script.
 *   * `verdict()` — the `{ verdicts: { [id]: assertions } }` a `drive` returns.
 *
 * Comparison matchers take `(label, actual, operand[, tolerance])`; `ok` takes
 * `(label, condition)`. The operand is what the value must equal / not equal / be
 * above / be below / be within — `expectEq("winner", end.winner, "left")` reads
 * "expect the winner to be left".
 */
function makeCheck(id) {
  const assertions = [];

  const record = (label, pass, expected, actual) => {
    const assertion = { label: String(label ?? ""), pass: Boolean(pass) };
    // Only comparison matchers carry a value pair; a bare `ok` records neither.
    if (expected !== undefined) assertion.expected = formatValue(expected);
    if (actual !== undefined) assertion.actual = formatValue(actual);
    assertions.push(assertion);
    return assertion.pass;
  };

  // The `{ [verdictId]: assertions }` map — the shape a `TtcVerdictStop` carries and
  // the inner value of a `verdict()`. Keyed by this check's single verdict id.
  const verdictMap = () => ({ [id]: assertions });
  const verdict = () => ({ verdicts: verdictMap() });

  const check = { id, assertions, verdict };
  for (const [op, comparator] of Object.entries(COMPARATORS)) {
    const suffix = op[0].toUpperCase() + op.slice(1);
    // Soft: record and continue.
    check[`expect${suffix}`] = (label, ...operands) => {
      const [pass, expected, actual] = comparator(...operands);
      return record(label, pass, expected, actual);
    };
    // Hard: record, then abort the whole script on failure, carrying the verdict map
    // decided so far so the driver can record it as a completed (failed) verdict.
    check[`assert${suffix}`] = (label, ...operands) => {
      const [pass, expected, actual] = comparator(...operands);
      const held = record(label, pass, expected, actual);
      if (!held) throw new TtcVerdictStop(verdictMap());
      return held;
    };
  }
  return check;
}

/**
 * Construct the `ttc` handle the driver passes to a script's `drive(api, ttc)`.
 * Its sole entry point is [`checkOne`], which opens the script's single verdict.
 */
export function createTtc() {
  return {
    /** Open the `check` for this script's one verdict, bound to `verdictId`. */
    checkOne: (verdictId) => makeCheck(verdictId),
  };
}
