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
import { call } from "../internal/errors.js";

/**
 * One program that already ran, as `history` lists it.
 *
 * It describes the program's **shape**, never its source: a directory that inlined every program
 * would put the whole session back into the context window, which is the one thing the library exists
 * to avoid. `get` fetches the source actually wanted.
 */
export interface ProgramSummary {
  /** The id its `submit_program` acknowledgement carried, which is what `get` takes. */
  id: string;

  /** The turn it ran on. */
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
   * Fetch this program's source, with its id already supplied.
   *
   * `gg.programs.get` for the common case where the summary is in hand.
   *
   * @ggop programs.get
   * @returns the exact source of the program that ran under that id.
   * @throws `ApiError` with `not-found` when the library has dropped that program since the
   * history was read.
   */
  source(): string;
}

/**
 * List the programs this session has already run, oldest first.
 *
 * Each entry carries its id, the turn it ran on, how big it was, and whether it ran to its end. It
 * lists shapes rather than sources, so `get` is what fetches one. The list survives a compaction, which
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
      id: entry.id,
      turn: entry.turn,
      lines: entry.lines,
      chars: entry.chars,
      ok: entry.ok,
      ...(entry.error === undefined ? {} : { error: entry.error }),
      source(): string {
        return get(entry.id);
      },
    })),
  );
}

/**
 * Fetch the exact source of one program that ran, by the id its acknowledgement carried.
 *
 * This is the first half of fixing a program without rewriting it: get what ran, patch it with
 * ordinary string work, and hand the result to `rerun`. What comes back is the program that
 * **executed**, so an id whose program was itself handed over by `rerun` yields the program that
 * ran rather than the few lines that asked for it, and fetch, patch and run compose turn after
 * turn — a rerun keeps the id of the submission it replaced.
 *
 * @ggop programs.get
 * @param id The program's id, as its acknowledgement carried it and as `history` reports it.
 * @returns the exact source of the program that ran under that id.
 * @throws `ApiError` with `unavailable` for an agent with no program library, and `not-found` —
 * naming the ids that are held — for an id this agent was never issued or one whose program is old
 * enough to have been dropped.
 */
export function get(id: string): string {
  return call(() => raw.get(id));
}

/**
 * Hand gg a program to run in place of this one, once this one has finished.
 *
 * It runs under this submission's id, and is what a later `get` of that id returns.
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
 * for a blank source, and `refused` for a second hand-over from the same program.
 */
export function rerun(source: string): void {
  call(() => raw.rerun(source));
}
