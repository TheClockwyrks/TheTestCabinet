// Where the debug surface comes from under an engine, and what happens when the
// build did not return one.
//
// IT IS A READ, NEVER A CONSTRUCTION. The surface is the build's deliverable: a
// simple engine's game returns it beside its state as `[state, debug]`, a
// structured engine's instance returns it from `initialize`, and in both cases
// the engine holds that same object and `engine.debug` is the only way it reaches
// a check. Nothing here could stand in for it, because a case's harness never
// imports the build's own module for the surface — what a check holds the surface
// to is the CASE's `surface.ts`, and a surface that departs from the
// specification is caught where a check reaches for the missing member.
//
// A BUILD THAT RETURNED NO SURFACE MUST NOT PRESENT AS A BROKEN HARNESS. Every
// suite builds its harness in a `beforeEach`, so a throw at this point would fail
// the hook and bury the real verdict under the harness's own stack. It is not
// swallowed either: {@link absentSurface} stands in and fails, by assertion, at
// the moment a check first reaches for an operation on it — naming the return the
// build owes. So the harness is built, teardown runs, and the fault lands exactly
// on the points whose checks reach the game through the surface, while a check
// that needs no surface is decided on its own merits.
//
// THE STAND-IN IS NOT THE ENGINELESS HALF'S. `../surface`'s `unexposedSurface`
// answers every member with a FUNCTION that fails when called; this one fails at
// the property ACCESS. That difference is load-bearing in both directions and
// neither is a better version of the other:
//
//   - Under an engine a surface member is reached and typed in the same
//     expression — the apply-threaded driver decides whether a member is a pose
//     or a reading by `typeof`, and a case's `instrumentation` suite asks
//     `typeof h.debug.op` outright. Answering a plausible function to a `typeof`
//     against a surface that does not exist is how a check passes on a build that
//     shipped nothing.
//   - Under no engine the surface lives in the page and every member is called
//     across a crossing, so failing at the access would fail the harness's own
//     probing before a check ever ran.
//
// Both ship. See the README's collision table.

import { fail } from "../assert";

/**
 * A stand-in for a surface the build never returned: reaching for ANY member
 * fails the check that reached, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so a check that reaches for an
 * operation this engine's surface carries — or one a later revision of the
 * specification adds — reports the missing surface rather than a `TypeError`.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
export function absentSurface<D extends object>(
  requirement: string,
  reason: string,
): D {
  return new Proxy({} as D, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return fail(requirement, reason);
    },
  });
}

/**
 * The debug surface the build returned, read off the engine that holds it.
 *
 * `requirement` is the `Expected:` line every check that reaches for a missing
 * surface lands on — what the case's `specs/instrumentation.md` says the build
 * owes — and is the case's own sentence, because the two engines phrase where the
 * surface comes from differently and a fault that misdescribed the return would
 * send a reviewer to the wrong line of the build.
 *
 * By the time this runs the engine's `initialize` has resolved, which is the one
 * precondition `engine.debug` has. A build whose `initialize` REJECTED never gets
 * here: the engine's own rejection fails the suite's `beforeEach` with the
 * engine's message, and such a build does not run on the engine under any entry
 * point, so it is not a harness's fault to report. What is decided here is a
 * return that is no surface — `null`, or something other than an object.
 */
export function readDebugSurface<Raw extends object>(
  engine: { readonly debug: unknown },
  requirement: string,
): Raw {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return absentSurface<Raw>(
      requirement,
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as Raw;
}

/**
 * Which of `ops` the surface does not carry as a callable member, in the order
 * they were named.
 *
 * A reading and not a verdict, so a case chooses where the fault lands. Two
 * designs are in the tree and both are legitimate: a case may FAULT AT BUILD —
 * check this once when the harness is made and replace the surface with an
 * {@link absentSurface} naming the missing operations, so every point the surface
 * decides reports the same fault — or it may THROW LATE, letting each check fail
 * where it reaches for what is not there. Which one a case wants depends on
 * whether its specification requires the operation of every build or only of a
 * variant's, and that is the case's to know.
 */
export function missingOps(
  raw: unknown,
  ops: readonly string[],
): readonly string[] {
  if (typeof raw !== "object" || raw === null) return [...ops];
  const surface = raw as Record<string, unknown>;
  return ops.filter((op) => typeof surface[op] !== "function");
}

/**
 * The fault sentence for a surface that turned up carrying less than the
 * specification requires, or `null` when it carries everything.
 */
export function missingOpsFault(
  raw: unknown,
  ops: readonly string[],
): string | null {
  const missing = missingOps(raw, ops);
  if (missing.length === 0) return null;
  return `engine.debug is present but carries no ${missing
    .map((op) => `${op}()`)
    .join(", ")}`;
}
