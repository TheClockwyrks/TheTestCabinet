/**
 * Fetch a program that already ran, and hand a patched copy back to be run in its place.
 *
 * Under responses-as-code a reply is a whole program, so a one-character mistake in a sixty-line
 * program costs the sixty lines again. The library makes the fix proportional to the mistake: fetch
 * what ran, patch it with ordinary string work, hand it back.
 *
 * The whole module is bought by a capability rather than by a tool, so it is present or absent
 * together.
 */

import * as raw from "test-cabinet:gg/programs";
import { U32_MAX, call, uint } from "../internal/errors.js";

/**
 * One program that already ran, as `history` lists it.
 *
 * It describes the program's **shape**, never its source: a directory that inlined every program
 * would put the whole session back into the context window, which is the one thing the library exists
 * to avoid. `get` fetches the source actually wanted.
 */
export interface ProgramSummary {
  /** The turn it ran on, which is what `get` takes. */
  turn: number;

  /** How many lines of source it was. */
  lines: number;

  /** How many characters of source it was. */
  chars: number;

  /** Whether it ran to its end, with no uncaught throw and no sandbox ceiling stopping it. */
  ok: boolean;

  /** The error it ended with, where it did not run to its end. */
  error?: string;

  /**
   * Fetch this program's source, with its turn already supplied.
   *
   * `gg.programs.get` for the common case where the summary is in hand.
   *
   * @ggop programs.get
   * @returns the exact source of the program that ran on that turn.
   * @throws `ApiError` with `not-found` when the library has dropped that turn since the history
   * was read.
   */
  source(): string;
}

/**
 * List the programs this session has already run, oldest first.
 *
 * Each entry carries the turn it ran on, how big it was, and whether it ran to its end. It lists
 * shapes rather than sources, so `get` is what fetches one. The list survives a compaction, which
 * makes it the way to find a program whose text has left the context window.
 *
 * @ggop programs.history
 * @returns one entry per program already run, oldest first; empty for an agent that has a library
 * and has run nothing yet.
 * @throws `ApiError` with `unavailable` for an agent with no program library.
 */
export function history(): ProgramSummary[] {
  // The method is attached here rather than declared on a class: nothing in a program ever
  // constructs a summary, and a constructible declaration would be one inviting it to.
  return call(() =>
    raw.history().map((entry) => ({
      turn: entry.turn,
      lines: entry.lines,
      chars: entry.chars,
      ok: entry.ok,
      ...(entry.error === undefined ? {} : { error: entry.error }),
      source(): string {
        return get(entry.turn);
      },
    })),
  );
}

/**
 * Fetch the exact source of one program that ran, as a string; the default is the most recent.
 *
 * This is the first half of fixing a program without rewriting it: get what ran, patch it with
 * ordinary string work, and hand the result to `rerun`. What comes back is the program that
 * **executed**, so a turn whose program was itself handed over by `rerun` yields the program that
 * ran rather than the few lines that asked for it, and fetch, patch and run compose turn after turn.
 *
 * @ggop programs.get
 * @param turn The turn whose program to fetch, as `history` reports it. Omit it for the most recent.
 * @returns the exact source of the program that ran on that turn.
 * @throws `ApiError` with `unavailable` for an agent with no program library, and `not-found` —
 * naming the turns that are held — for a turn that ran no program or one old enough to have been
 * dropped.
 */
export function get(turn?: number): string {
  return call(() => raw.get(uint("get", "turn", turn, U32_MAX)));
}

/**
 * Hand gg a program to run in place of this one, once this one has finished.
 *
 * Nothing is undone: every call the handing-over program already made stands, and the program that
 * runs next sees the world this one left behind — so handing over before doing work that should not
 * happen twice is the shape that works.
 *
 * The first call stands and a second is refused, because a silently replaced program is a change
 * nobody can see. A failed handing-over program cancels the hand-over along with everything else it
 * decided, and the turn is reported as an ordinary error instead.
 *
 * @ggop programs.rerun
 * @param source The program to run in place of this one. It may not be blank.
 * @throws `ApiError` with `unavailable` for an agent with no program library, `invalid-argument`
 * for a blank source, and `refused` for a second hand-over in one turn.
 */
export function rerun(source: string): void {
  call(() => raw.rerun(source));
}
