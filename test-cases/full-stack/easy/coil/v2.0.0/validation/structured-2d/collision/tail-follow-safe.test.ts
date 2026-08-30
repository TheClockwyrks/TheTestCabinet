/*
 * Coil validator: `collision.tail-follow-safe`. PLACEHOLDER.
 *
 * Chasing the vacating tail is safe.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * On a tick that eats nothing the head may enter the cell the tail is
 * vacating: the round carries on and the chain holds its length, so a snake
 * can chase its own tail.
 *
 * HOW:
 * pose a closed loop of a chain with the pellet cleared so the head's next
 * cell is the current tail, run one tick, and confirm the round is still
 * playing.
 *
 * MEDIA IT MUST CAPTURE: tail (replay).
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

test("collision.tail-follow-safe", () => {
  throw new Error(
    "validator not implemented: collision/tail-follow-safe.test.ts",
  );
});
