// presentation/arm-spokes-visible — a shaft is drawn from an arm's base out to
// each of its grippers, and to no other direction.
//
// THE RULE. "An arm's spokes, its length, and whether each gripper is holding are
// visible" (`specs/parts.md`, Presentation), and `specs/assets.md` puts "An arm's
// spokes, the shaft between a base and each gripper, and the length it stands at"
// under "What stays drawn in code", fixed by `specs/parts.md`.
//
// WHICH DIRECTIONS CARRY A SPOKE is that file's own table: "a base fixed on the
// anchor hex, a length, and one gripper per spoke at `base + length * DIRS[d]` for
// each spoke direction `d`. The part's rotation names its first spoke, and the
// variant names the rest" — `arm` and `piston` one spoke, `biarm` two, `triarm`
// three, `hexarm` "all six". So "a hexarm shows six spokes and an arm one" is read
// in BOTH directions: a shaft where the anatomy puts a gripper, and no shaft where
// it puts none.
//
// WHERE THE SHAFT IS READ. The six directions are the `DIRS` of `specs/field.md`,
// clockwise from east, so `DIRS[d]` lies `60 * d` degrees round from the `+x` axis
// and the ray to a gripper at length `2` is `2 * HEX_PITCH` (`96`) units long. The
// sample is taken at `HEX_PITCH` (`48`) from the base — halfway along that ray,
// clear of the `40`-unit hub centred on the base and of the `32`-unit gripper
// centred at its far end, so what is read there is the shaft itself and not a
// sprite drawn over either end.
//
// THE COMPARISON IS AGAINST THE SAME POINTS, BARE, so no colour, width, or style
// is required of the build: the six rays are read on the empty field and again
// with the arm placed, and a direction carries a shaft when its point changed.
//
// LENGTH `2` ON PURPOSE. At `ARM_MIN_LEN` (`1`) the gripper's own sprite reaches
// back to within `16` units of the hub and leaves no clear stretch of shaft to
// read; at `2` the halfway point is `28` units from either sprite.
//
// THE VERDICT. A `hexarm` at rotation `0` draws a shaft along all six directions.
// An `arm` at rotation `0` draws one along `DIRS[0]` and none along the other
// five.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { DIRS, HEX_PITCH } from "../constants";
import { hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  CHANNEL_EPSILON,
  clearWorld,
  colorDistance,
  createHarness,
  openChallengeDocument,
  placePart,
  sampleColor,
  type Harness,
  type Rgb,
} from "../harness";
import { spokesOf } from "../parts";

/** The length the two arms stand at, in hexes. */
const LENGTH = 2;

/** How far along a ray the shaft is read: halfway to a gripper at `LENGTH`. */
const ALONG = (LENGTH * HEX_PITCH) / 2;

/** Where the ray `DIRS[d]` reaches, `ALONG` units from the base. */
function alongSpoke(d: number): { x: number; y: number } {
  const base = hexCenter(ORIGIN);
  const radians = (d * 60 * Math.PI) / 180;
  return {
    x: base.x + Math.cos(radians) * ALONG,
    y: base.y + Math.sin(radians) * ALONG,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The six rays' colours, on whatever the frame last drew. */
async function readRays(): Promise<Rgb[]> {
  const read: Rgb[] = [];
  for (let d = 0; d < DIRS.length; d += 1) {
    const point = alongSpoke(d);
    read.push(await sampleColor(h, point.x, point.y, 2));
  }
  return read;
}

it("draws a shaft along every direction its anatomy puts a gripper on, and along no other", async () => {
  await openChallengeDocument(h, BARE);
  await h.advance(1);
  const bare = await readRays();

  for (const kind of ["hexarm", "arm"] as const) {
    await clearWorld(h);
    const part = await placePart(h, kind, ORIGIN, 0);
    await h.debug.setPartLength(part, LENGTH);
    // The editor outlines the selected part's hexes (`specs/editor.md`), which
    // would put paint on rays this point requires to be bare.
    await h.debug.setSelected(null);
    await h.advance(1);
    await captureStill(h, "spokes");

    const drawn = await readRays();
    const spokes = spokesOf(kind, 0);
    for (let d = 0; d < DIRS.length; d += 1) {
      const moved = colorDistance(bare[d] as Rgb, drawn[d] as Rgb);
      if (spokes.includes(d)) {
        assertGreaterThan(
          moved,
          CHANNEL_EPSILON,
          `a ${kind} at rotation 0 carries a gripper on spoke ${d}, so a shaft is drawn from its base out along that direction`,
        );
      } else {
        assertLessThanOrEqual(
          moved,
          CHANNEL_EPSILON,
          `a ${kind} at rotation 0 carries no gripper on spoke ${d}, so nothing is drawn out along that direction and a hexarm's six spokes are told from an arm's one`,
        );
      }
    }
  }
});
