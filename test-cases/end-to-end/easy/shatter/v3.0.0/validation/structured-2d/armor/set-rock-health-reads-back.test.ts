// armor/set-rock-health-reads-back — posing a rock's health reads back.
//
// `specs/instrumentation.md`, The rocks: "`setRockHealth(id, hp)` sets that rock's
// remaining hits, a whole number from `1` to the full health of its size", and the
// Snapshot shape's note that every field an operation can set is present "so every
// operation is verifiable by setting a value and reading it back". This item is
// that verification, and it is the point every other armor scenario stands on: a
// surface that swallows the value silently would leave `armor/health-falls-by-one`
// and both recycling items reading a health nobody posed.
//
// EVERY LEGAL VALUE OF EVERY SIZE, which is six poses in all — a Large's `3`, `2`
// and `1`, a Medium's `2` and `1`, and a Small's `1`. A sweep rather than one
// value, because the wrong models differ only at the ends: a build that clamps
// every rock to its size's full health passes at `3` on a Large and fails at `2`; a
// build that clamps to `1` does the reverse; a build that stores the value on the
// wrong rock passes on a field of one rock and fails on this one, which holds three
// at once.
//
// WHAT THE ROCKS ARRIVE CARRYING IS READ, NOT ASSERTED. `addRock` delivers a rock
// at full health for its size (`specs/instrumentation.md`), and the figure that is
// belongs to `armor/health-large-3` and its two siblings; this item takes whatever
// each rock arrives with as the value the other two rocks must still be reading
// while a third is posed, so a build with a wrong armor table fails there and is
// graded here on `setRockHealth` alone.
//
// EACH POSE IS READ BACK BEFORE THE NEXT IS MADE, and no frame runs between them:
// under this engine a pose acts on the live game at the moment of the call
// (`specs/instrumentation.md`), so the reading is of the pose alone and not of a
// tick of the game's own rules. The OTHER two rocks are read back at each step too,
// so a build whose `setRockHealth` writes to the whole roster fails here rather
// than somewhere downstream.
//
// THE FIELD IS POSED AND STILL. `startPlaying` empties every roster and shuts both
// world gates and the ship's contact test, and the three rocks stand far apart on
// quiet ground at rest — `specs/collision.md` gives a rock and a rock no
// interaction anyway, so nothing on the field can change a health but the surface.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  type Harness,
  type RockSize,
} from "../harness";
import { healthOf, poseHealth } from "./scene";

/**
 * Where the three rocks stand: far apart, clear of the star's drawn extent
 * (nothing of it is drawn beyond `180`, `specs/field.md`), clear of the HUD, which
 * `specs/ui.md` puts in the upper portion of the field, and each whole circle
 * inside the field so nothing the still shows straddles a seam.
 */
const SPOTS: Readonly<Record<RockSize, { x: number; y: number }>> = {
  large: { x: 240, y: 540 },
  medium: { x: 640, y: 660 },
  small: { x: 1040, y: 540 },
};

/** The sizes, in the order the rocks are posed and read. */
const SIZES: readonly RockSize[] = ["large", "medium", "small"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports back every legal health posed for every size", async () => {
  startPlaying(h);

  const ids = new Map<RockSize, number>();
  for (const size of SIZES) {
    ids.set(size, poseRock(h, size, SPOTS[size].x, SPOTS[size].y));
  }

  // What each rock is expected to be reading at any point of the sweep, so the
  // two rocks a pose did not name are checked as well as the one it did. It
  // opens at whatever each rock arrived carrying — read, not asserted — and
  // moves only when a pose names that rock.
  const expected = new Map<RockSize, number>(
    SIZES.map((size) => [
      size,
      healthOf(
        requireRock(h.snapshot(), ids.get(size) as number, `the posed ${size}`),
        `the posed ${size}`,
      ),
    ]),
  );

  const readAll = (stage: string): void => {
    for (const size of SIZES) {
      const id = ids.get(size) as number;
      const rock = requireRock(h.snapshot(), id, `${stage}: the ${size}`);
      assertEqual(
        healthOf(rock, `${stage}: the ${size}`),
        expected.get(size),
        `${stage}: the ${size}'s health — setRockHealth reports back the ` +
          "value posed for the rock it names, and leaves every other rock as " +
          "it stands (specs/instrumentation.md)",
      );
    }
  };

  for (const size of SIZES) {
    const id = ids.get(size) as number;
    for (let hp = ROCK_HEALTH[size]; hp >= 1; hp -= 1) {
      poseHealth(h, id, hp);
      expected.set(size, hp);
      readAll(`with the ${size} posed at ${hp}`);
    }
  }

  await h.advance(1);
  captureStill(h, "posed");
});
