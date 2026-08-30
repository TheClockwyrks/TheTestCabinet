/*
 * Coil validator: `hud.best-drawn`. PLACEHOLDER.
 *
 * The best score is drawn.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * After a best is posed, a frame of the live round draws that figure and the
 * BEST label above it.
 *
 * HOW:
 * pose a distinctive best above the live score, render a live frame, and find
 * the text draw.
 *
 * MEDIA IT MUST CAPTURE: best (image).
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

test("hud.best-drawn", () => {
  throw new Error("validator not implemented: hud/best-drawn.test.ts");
});
