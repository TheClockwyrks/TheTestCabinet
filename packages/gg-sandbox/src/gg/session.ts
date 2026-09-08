/**
 * End the session.
 *
 * An ending is declared rather than performed: the program runs on to its end, and a program that
 * then fails cancels the ending.
 */

import * as raw from "test-cabinet:gg/session";
import { call, requireString, typeName } from "../internal/errors.js";
import { ApiError } from "./core.js";

/**
 * End the session, reporting what was done in a sentence or two.
 *
 * It does not stop the program: whatever follows it still runs. A program that then fails cancels
 * the ending, and the session gets another turn.
 *
 * @ggop session.finish
 * @param summary What was done, in a sentence or two.
 * @throws `ApiError` with `invalid-argument` for a blank summary, and `unavailable` when this
 * session ends some other way.
 */
export function finish(summary: string): void {
  requireString("finish", "a summary string", summary);
  call(() => raw.finish(summary));
}

/**
 * Accept the work under review: it meets every completion criterion and stays in scope.
 *
 * This ends the session. It does not stop the program: whatever follows it still runs.
 *
 * @ggop session.approve
 * @throws `ApiError` with `unavailable` when this session ends some other way.
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
 * @throws `ApiError` with `invalid-argument` when the list is empty, and `unavailable` when this
 * session ends some other way.
 */
export function requestChanges(items: string[]): void {
  if (!Array.isArray(items)) {
    throw new ApiError(
      "requestChanges",
      "invalid-argument",
      `expected an array of strings, got ${typeName(items)}`,
    );
  }
  const listed = items.map((item) =>
    typeof item === "string" ? item : String(item),
  );
  call(() => raw.requestChanges(listed));
}
