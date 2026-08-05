/**
 * The `programs` object: the library of programs this agent has already run.
 *
 * These are not gg tools. No capability offers one *as a tool*, nothing dispatches one by name, and
 * cataloguing them among the tools would break the `boundTools() == ALL_TOOL_NAMES` bijection the
 * committed component is checked against — so, like `session`, `docs` and `views`, they have their
 * own membrane interface, their own {@link "../catalogue.js".PROGRAM_ENTRIES} array, and their own
 * object. Unlike those three the shim binds this one from the `library` flag the host passes to
 * `run`, because it is gated by a capability rather than by a tool or a role.
 *
 * **Why the object exists.** Under responses-as-code a reply is a whole program, so a one-character
 * mistake in a sixty-line program costs the sixty lines again. The library makes the fix
 * proportional to the mistake: fetch what ran, patch it with ordinary string work, hand it back.
 *
 * ```ts
 * const source = programs.get();
 * programs.rerun(source.replace("cosnt", "const"));
 * ```
 *
 * Every JSDoc block below is **model-facing**: `tools/signatures.mjs` reflects it into the signature
 * catalogue, and it is what `view.openDocsView("get")` shows the model.
 */

import * as raw from "test-cabinet:gg/programs";
import { U32_MAX, call, uint } from "../errors.js";
import type { ProgramSummary } from "../types.js";

/**
 * The programs you have already run this session, oldest first — each with the turn it ran on, how
 * big it was, and whether it ran to its end.
 *
 * It lists shapes, not sources: fetch the one you want with `programs.get(turn)`. The list survives
 * a compaction, so it is also how you find a program whose text has left your context window.
 *
 * An agent with no program library throws `unavailable`. It is empty — never an error — for one
 * that has a library and has run nothing yet.
 */
export function history(): ProgramSummary[] {
  return call(() =>
    raw.history().map((entry) => ({
      turn: entry.turn,
      lines: entry.lines,
      chars: entry.chars,
      ok: entry.ok,
      ...(entry.error === undefined ? {} : { error: entry.error }),
    })),
  );
}

/**
 * The exact source of one program you ran, as a string. With no argument, your most recent one.
 *
 * This is the first half of fixing a program without rewriting it: get what ran, patch it with
 * ordinary string work (`replace`, `replaceAll`, a template literal), and hand the result to
 * `programs.rerun`. What comes back is the program that **executed** — so when a turn's program was
 * itself handed over by `programs.rerun`, you get the program that ran, not the few lines that asked
 * for it, and fetch-patch-run composes turn after turn.
 *
 * A turn that ran no program, or one old enough that the library has dropped it, throws `not-found`
 * naming the turns that are held; `programs.history()` lists them.
 *
 * @param turn The turn whose program to fetch, as `programs.history()` reports it. Omit it for
 * your most recent one.
 */
export function get(turn?: number): string {
  return call(() => raw.get(uint("get", "turn", turn, U32_MAX)));
}

/**
 * Hand gg a program to run in place of this one. Your program finishes, then gg compiles and runs
 * `source` as this turn's program.
 *
 * Use it with `programs.get` to fix a program without re-emitting it. Nothing is undone: every call
 * your program already made stands, and the program that runs next sees the world your program left
 * behind — so hand over BEFORE doing work you do not want done twice.
 *
 * The first call stands; a second throws `refused`, because a silently replaced program is a change
 * you cannot see. A blank source is `invalid-argument`. If your program then throws, the hand-over is
 * cancelled along with everything else the failed program decided, and you get an ordinary error turn
 * instead. Chains are bounded: hand over once per turn, and write the fixed program to do the work.
 *
 * @param source The program to run in place of this one. It may not be blank.
 */
export function rerun(source: string): void {
  call(() => raw.rerun(source));
}
