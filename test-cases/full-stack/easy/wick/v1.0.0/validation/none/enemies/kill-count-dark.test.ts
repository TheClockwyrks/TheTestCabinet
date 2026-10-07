// enemies/kill-count-dark — the Dark's death raises the kill count.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("The life of an enemy"):
// "On any tick that leaves `hp` at or below `0` the enemy dies on that tick: it
// is removed, the kill count rises by one, its drop appears at its center, and
// the `kill` cue plays as `specs/ui.md` states. Kill count and drops apply to
// every rank alike." The three ranks are the `common`, the `elite`, and the
// `dark` of "Every enemy has a rank, `common`, `elite`, or `dark`", so a moth,
// a mothwing, and the Dark are one of each: a build that counted only what
// dropped a gem, or that left the Dark outside the count as the Drops table
// leaves it outside the drops, is separated by the second and the third death.
//
// THE POSE. Three isolated nights in turn, each holding nothing but the
// lamplighter, one enemy at `(150, 0)` with its `hp` posed to `1`, and a
// level-1 Ember bolt on its center; every faculty held so nothing else lands in
// the night. A bolt "hit[s] at the position it was created at"
// (`specs/world.md`, phase 6) and carries `10` damage (`specs/weapons.md`, row
// 1 of `EMBER_LEVELS` times a `damageMul` of `1`), so the one tick each night
// runs is exactly one death. Each night's count is read against the count that
// night began with, so the three readings do not lean on one another and a
// build that resets the count between runs is read the same as one that does
// not.
//
// TOLERANCE. None: a kill count is a whole number.
//
// The other ranks are `enemies/kill-count-common`, `enemies/kill-count-elite`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertDead, killOne } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises kills by one on the Dark's death", async () => {
  const death = await killOne(h, "dark");
  await captureStill(h, "kills");

  assertDead(death, "dark");
  assertEqual(
    death.after.run.kills,
    death.before.run.kills + 1,
    "kills after the tick the Dark died on",
  );
});
