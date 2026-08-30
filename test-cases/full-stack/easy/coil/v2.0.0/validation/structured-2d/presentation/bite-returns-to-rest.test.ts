/*
 * Coil validator: `presentation.bite-returns-to-rest`. PLACEHOLDER.
 *
 * The bite returns the head to rest.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * BITE_SECONDS (0.25 s) after the eat the head cell is painted with the
 * resting frame again, and stays on it until the next eat.
 *
 * HOW:
 * record the image painted on the head cell across BITE_SECONDS after an eat
 * and on for several ticks beyond it.
 *
 * MEDIA IT MUST CAPTURE: rest (replay).
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

test("presentation.bite-returns-to-rest", () => {
  throw new Error(
    "validator not implemented: presentation/bite-returns-to-rest.test.ts",
  );
});
