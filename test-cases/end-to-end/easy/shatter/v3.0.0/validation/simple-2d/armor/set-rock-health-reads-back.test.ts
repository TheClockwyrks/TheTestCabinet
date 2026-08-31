// rocks/set-rock-health-reads-back — posing a rock's health reads back.
//
// `specs/instrumentation.md`: "setRockHealth(id, hp) — Sets that rock's remaining
// hits, a whole number from 1 to the full health of its size", and the snapshot
// carries every rock's `health`. This is the set-then-read that grades the pair,
// and it is the operation the two recycling checks in this group pose their
// scenario with — so a build whose `setRockHealth` writes somewhere the game does
// not read fails HERE, by name, rather than dragging the recycling items down with
// an unexplained verdict.
//
// EVERY LEGAL VALUE, ONE ROCK EACH. `specs/rocks.md` fixes the legal range per
// size — a Large 1 to 3, a Medium 1 to 2, a Small 1 — so the table below is built
// straight out of `ROCK_HEALTH` and covers all six by construction. Each gets a
// rock of its own rather than one rock walked through its values, so a build that
// honours only the FIRST write, or only a write that lowers health, is caught: the
// six are posed against six rocks that all entered at full health for their size,
// and every one of them is read back.
//
// The rocks stand well apart, clear of the star's drawn extent and of one another,
// so the still this leaves shows the six side by side. They interact with nothing:
// nothing is fired, and `specs/collision.md` has rocks pass through one another
// anyway.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH } from "../../src/constants";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  type Harness,
  type RockSize,
} from "../harness";
import { healthOf, poseHealth } from "./scene";

/** The three sizes, largest first: the rows of `specs/rocks.md`'s armor table. */
const ROCK_SIZES: readonly RockSize[] = ["large", "medium", "small"];

/**
 * Where the six rocks stand, in the order the table below walks them.
 *
 * Bare field: each is more than the star's whole drawn extent (`180`,
 * `specs/field.md`) from its centre, more than a Large's diameter from any other,
 * clear of the ship's safe point at `(640, 560)`, and far enough inside the field
 * that no rock straddles a seam.
 */
const SPOTS: readonly { x: number; y: number }[] = [
  { x: 160, y: 320 },
  { x: 500, y: 200 },
  { x: 840, y: 200 },
  { x: 1120, y: 200 },
  { x: 160, y: 580 },
  { x: 900, y: 580 },
];

/** One posing: a size, a legal health for it, and where that rock stands. */
interface Posing {
  size: RockSize;
  hp: number;
  x: number;
  y: number;
}

/** Every legal health of every size, largest size first, lowest health first. */
const POSINGS: readonly Posing[] = ROCK_SIZES.flatMap((size) =>
  Array.from({ length: ROCK_HEALTH[size] }, (_unused, index) => ({
    size,
    hp: index + 1,
  })),
).map((posing, index) => ({
  ...posing,
  x: SPOTS[index]?.x ?? 0,
  y: SPOTS[index]?.y ?? 0,
}));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every legal health that setRockHealth posed, for every size", async () => {
  if (POSINGS.length !== SPOTS.length) {
    fail(
      `a placement for each of the ${POSINGS.length} legal healths ` +
        "(specs/rocks.md)",
      `${SPOTS.length} placements`,
    );
  }
  startPlaying(h);

  const posed: { spec: Posing; id: number }[] = [];
  for (const spec of POSINGS) {
    const id = poseRock(h, spec.size, spec.x, spec.y);
    poseHealth(h, id, spec.hp);
    posed.push({ spec, id });
  }

  // One tick, so the picture the still keeps is of the six as they now stand.
  await h.advance(1);
  captureStill(h, "posed");

  const snapshot = h.snapshot();
  for (const { spec, id } of posed) {
    const context = `a ${spec.size} posed at health ${spec.hp}`;
    const rock = rockById(snapshot, id, context);
    assertEqual(
      rock.size,
      spec.size,
      `${context}: the size it was added at (specs/instrumentation.md)`,
    );
    assertEqual(
      healthOf(rock, context),
      spec.hp,
      `${context}: the health setRockHealth posed (specs/instrumentation.md)`,
    );
  }
});
