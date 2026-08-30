/*
 * Coil validator: `scoring.session-starts-fresh`. PLACEHOLDER.
 *
 * A fresh session starts at a best of zero.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A newly loaded game opens with a best of 0: nothing about a previous session
 * is carried across, since nothing persists between sessions.
 *
 * HOW:
 * reach a best in one session, then load the build again as a new session and
 * read the best on the title screen.
 *
 * MEDIA IT MUST CAPTURE: fresh (image).
 *
 * It is a COMMON point, decided for every variant.
 *
 * The manifest declares this path, so the file must exist for the version to
 * resolve. It throws rather than passing, so a point whose suite has not been
 * written yet can never be mistaken for a point that passed. Replace the body:
 * pose the scenario through the debug surface alone, clearing everything the
 * claim is not about, run the real systems for a bounded span, assert the one
 * claim above through the shared assertion helpers, and capture the declared
 * media around the drive rather than around the arrangement.
 */
import { test } from "vitest";

test("scoring.session-starts-fresh", () => {
  throw new Error(
    "validator not implemented: scoring/session-starts-fresh.test.ts",
  );
});
