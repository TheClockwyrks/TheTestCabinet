// presentation/sprites-separate-from-the-sky — every produced sprite the field
// draws reads against the field that is already there.
//
// THE RULE. "Every sprite reads on the dark sky, and none of them relies on a
// background behind it" (`specs/assets.md`, The art bar). The sprites the field
// draws are the rows of that file's own tables: the fifteen motes, the two
// filament strips, the twelve sigil glyphs, the two arm hubs, the two grippers,
// the wheel hub, the fixture mount, and the two aperture sheets. (The instruction
// glyphs are drawn "centered in its tape cell" rather than on the field, so they
// are not this point's.)
//
// WHAT "READS" IS READ AS. `specs/ui.md` "fixes no palette, no font, and no
// background", so nothing here may say what a sprite looks like. What it reads is
// the weaker thing the sentence above states: the place a sprite is drawn is drawn
// DIFFERENTLY from that same place with the sprite absent. A sprite painted in the
// sky's own colour, or one drawn onto a plate of its own that is itself the sky,
// leaves the field where it landed as it found it and fails.
//
// EACH POSE IS READ TWICE, and the two frames differ by exactly one thing. The
// world is emptied, a frame is drawn and the square around the place read; then
// the one thing this row is about is put there, a frame is drawn, and the same
// square is read again. `clearWorld` empties the machine and the field between
// rows, so no row leaves anything behind for the next.
//
// AND A PRODUCED SPRITE REALLY LANDED THERE. `specs/assets.md` draws each sprite
// "centered on the thing it depicts", so beside the pixels each row reads the
// frame's own operations and requires an image drawn with its centre on the place
// under test — otherwise a build that painted the shape in code would pass a point
// about its produced files.
//
// THE RUN IS HELD PAUSED. Fixtures exist only within a run ("every wheel's six
// fixtures appear", `specs/simulation.md`) and a mote is spawned onto a live
// field, so every row is posed inside one; pausing holds the fraction where it is
// (`specs/simulation.md`), so no cycle runs, nothing moves, and no boundary can
// spawn or consume anything between the two frames of a row.
//
// THE VERDICT. Every row's square is drawn differently once its sprite is on it,
// over at least `MIN_DISTINCT_SHARE` of that square, with a produced image centred
// there.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { MOTES, TRANSFORMING_SIGILS } from "../constants";
import { at, hexCenter, type Hex, type StagePoint } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  clearWorld,
  createHarness,
  differingShare,
  imagesNear,
  openBareRun,
  placePart,
  placeRise,
  placeSet,
  spawnConstellation,
  spawnMote,
  takeGrip,
  type Harness,
  type PixelRect,
} from "../harness";

/**
 * Half the side of the square a place is read over, in logical units.
 *
 * `MOTE_R` (`22`) bounds a mote's paint and the widest sprite the field draws is
 * `48` across, so a `40 x 40` square about the place is inside every one of them
 * and reaches no neighbouring hex, whose centre is `HEX_PITCH` (`48`) away.
 */
const HALF = 20;

/**
 * The least share of that square that must be drawn differently.
 *
 * The case's own figure for "visibly distinct" is one percent of a rectangle
 * (`editor/a-spent-entry-is-drawn-distinct`); this is five times it, because a
 * sprite is not a mark on a slot but the thing itself, and it must not be possible
 * to pass this on a stray pixel of anti-aliasing.
 */
const MIN_DISTINCT_SHARE = 0.05;

/** The hex a filament's strip is centred on the way between: the midpoint. */
function midpointOf(a: Hex, b: Hex): StagePoint {
  const from = hexCenter(a);
  const to = hexCenter(b);
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The square about a stage point, read off the frame that last drew. */
function square(point: StagePoint): Promise<PixelRect> {
  return h.pixelRect(point.x - HALF, point.y - HALF, 2 * HALF, 2 * HALF);
}

/**
 * Empty the world, read the place bare, run `pose`, and read it again.
 *
 * `where` is answered by the pose rather than given to it, because a row such as
 * the closed gripper poses part of its scene BEFORE the bare reading is taken —
 * the mote a gripper closes on is not the sprite under test.
 */
async function readAcross(
  where: StagePoint,
  before: () => Promise<void>,
  pose: () => Promise<void>,
): Promise<{ bare: PixelRect; drawn: PixelRect; sprites: number }> {
  await clearWorld(h);
  await before();
  await h.advance(1);
  const bare = await square(where);
  await pose();
  await h.advance(1);
  const drawn = await square(where);
  const sprites = imagesNear(await h.lastCalls(), where, HALF).length;
  return { bare, drawn, sprites };
}

it("draws every produced field sprite so its place differs from the field behind it", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });

  /** One produced sprite, the place it lands, and how it is put there. */
  const rows: {
    name: string;
    where: StagePoint;
    before?: () => Promise<void>;
    pose: () => Promise<void>;
  }[] = [
    ...MOTES.map((type) => ({
      name: `the ${type} mote sprite`,
      where: hexCenter(ORIGIN),
      pose: async (): Promise<void> => {
        await spawnMote(h, ORIGIN, type);
      },
    })),
    ...[1, 3].map((weight) => ({
      name:
        weight === 3 ? "the triune filament strip" : "the plain filament strip",
      where: midpointOf(ORIGIN, at(1, 0)),
      pose: async (): Promise<void> => {
        await spawnConstellation(
          h,
          [
            { hex: ORIGIN, type: "nova" },
            { hex: at(1, 0), type: "nova" },
          ],
          [{ a: 0, b: 1, weight }],
        );
      },
    })),
    ...TRANSFORMING_SIGILS.map((kind) => ({
      name: `the ${kind} glyph`,
      where: hexCenter(ORIGIN),
      pose: async (): Promise<void> => {
        await placePart(h, kind, ORIGIN, 0);
      },
    })),
    {
      name: "the arm hub",
      where: hexCenter(ORIGIN),
      pose: async (): Promise<void> => {
        await placePart(h, "arm", ORIGIN, 0);
      },
    },
    {
      name: "the piston hub",
      where: hexCenter(ORIGIN),
      pose: async (): Promise<void> => {
        await placePart(h, "piston", ORIGIN, 0);
      },
    },
    {
      name: "the open gripper",
      where: hexCenter(at(1, 0)),
      pose: async (): Promise<void> => {
        await placePart(h, "arm", ORIGIN, 0);
      },
    },
    {
      name: "the closed gripper",
      where: hexCenter(at(1, 0)),
      // The mote is on the field for BOTH readings, so what the two differ by is
      // the arm that closed on it rather than the mote it holds.
      before: async (): Promise<void> => {
        await spawnMote(h, at(1, 0), "dust");
      },
      pose: async (): Promise<void> => {
        const arm = await placePart(h, "arm", ORIGIN, 0);
        const held = (await h.snapshot()).sim?.motes[0]?.id ?? -1;
        await takeGrip(h, arm, 0, held);
      },
    },
    {
      name: "the wheel hub",
      where: hexCenter(ORIGIN),
      pose: async (): Promise<void> => {
        await placePart(h, "wheel", ORIGIN, 0);
      },
    },
    {
      name: "the fixture mount",
      where: hexCenter(at(1, 0)),
      pose: async (): Promise<void> => {
        await placePart(h, "wheel", ORIGIN, 0);
      },
    },
    {
      name: "the rise aperture",
      where: hexCenter(ORIGIN),
      pose: async (): Promise<void> => {
        await placeRise(h, 0, ORIGIN, 0);
      },
    },
    {
      name: "the set aperture",
      where: hexCenter(ORIGIN),
      pose: async (): Promise<void> => {
        await placeSet(h, 0, ORIGIN, 0);
      },
    },
  ];

  for (const row of rows) {
    const read = await readAcross(
      row.where,
      row.before ?? (async (): Promise<void> => undefined),
      row.pose,
    );
    await captureStill(h, "over-sky");
    assertGreaterThanOrEqual(
      read.sprites,
      1,
      `${row.name} is a produced sprite drawn centred on the thing it depicts, so the frame drew an image there`,
    );
    assertGreaterThan(
      differingShare(read.bare, read.drawn),
      MIN_DISTINCT_SHARE,
      `${row.name} leaves the field where it lands drawn differently from the same place with it absent, so it reads on the dark sky rather than on a ground of its own`,
    );
  }
});
