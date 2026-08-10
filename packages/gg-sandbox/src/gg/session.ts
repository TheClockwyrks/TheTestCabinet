/**
 * End the session, in the one shape this agent's role produces.
 *
 * Under responses-as-code every reply is a program, so there is no prose turn that could mean "the
 * work is done" — a model that answers "task complete" has written a reply that failed to be a
 * program, not an ending.
 *
 * An ending is a **result**, and a role's result has a shape: work reports what was done, a review
 * returns a verdict. So there is one function per shape, and exactly one group is bound per program.
 * A reviewer's program has no `finish` in scope at all, which is the same capability model the rest
 * of this surface uses.
 *
 * Ending is a fact about the agent rather than about the program that declared it, so nothing here
 * holds state: the host records the declaration, keeps it while the program runs on, and revokes it
 * if the program then fails.
 */

import * as raw from "test-cabinet:gg/session";
import { call, requireString, typeName } from "../internal/errors.js";
import { ToolError } from "./core.js";

/**
 * End the session, reporting what was done in a sentence or two.
 *
 * It does not stop the program: whatever follows it still runs, so it belongs last, once the calls
 * that do the work have confirmed the work is really done. A program that then fails cancels the
 * ending, and the session gets another turn.
 *
 * @ggop session.finish
 * @param summary What was done, in a sentence or two.
 */
export function finish(summary: string): void {
  requireString("finish", "a summary string", summary);
  call(() => raw.finish(summary));
}

/**
 * Accept the work under review: it meets every completion criterion and stays in scope.
 *
 * This ends the session. It does not stop the program, so it belongs last, once the change has
 * actually been read.
 *
 * @ggop session.approve
 */
export function approve(): void {
  call(() => raw.approve());
}

/**
 * Reject the work under review, listing every change that must be made before it can be accepted.
 *
 * Each item says what is wrong and what to change, and the list may not be empty. This ends the
 * session and does not stop the program.
 *
 * @ggop session.request_changes
 * @param items Every change that must be made before the work can be accepted, one per entry: what is
 * wrong, and what to change. It may not be empty.
 */
export function requestChanges(items: string[]): void {
  if (!Array.isArray(items)) {
    throw new ToolError(
      "requestChanges",
      "invalid-argument",
      `expected an array of strings, got ${typeName(items)}`,
    );
  }
  const listed = items.map((item) => (typeof item === "string" ? item : String(item)));
  call(() => raw.requestChanges(listed));
}
