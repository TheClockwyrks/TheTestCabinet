/*
 * Coil validator: `combo.caps-at-max`. PLACEHOLDER.
 *
 * The multiplier caps at COMBO_MAX.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * An eat resolved at COMBO_MAX (5) with an open window leaves M at 5 rather
 * than raising it further.
 *
 * HOW:
 * pose M at COMBO_MAX with an open window, eat a pellet, and read the
 * multiplier.
 *
 * MEDIA IT MUST CAPTURE: cap (replay).
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

test("combo.caps-at-max", () => {
  throw new Error("validator not implemented: combo/caps-at-max.test.ts");
});
