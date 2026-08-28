// flarefish/no-tell — between flares a Flarefish out in the dark shows nothing of
// itself: nothing in what it reports, and nothing on the canvas.
//
// `specs/predators/flarefish.md`: "Outside a flare the Flarefish produces no
// light, no wavefront and no glow of its own, so between flares it is drawn only
// where the forager's light, a sonar mark, or a flare falls on it", and "Outside a
// flare, `flareCharging` and `flaring` are false and `flareRadius` is `0`."
// `specs/predators.md` fixes what `lit` then says: "A predator's body is drawn
// only while it is lit this instant, which the snapshot reports as `lit` ...
// Between those glimpses the body is not drawn, wherever the predator is."
//
// THE CANVAS IS THE HALF THAT MATTERS, and it is why this is not simply four field
// reads. A build can report every flag correctly and still leave an amber mote, a
// residual glow or the tail of a wavefront painted where the Flarefish stands —
// which hands the player exactly the tell this hunter is defined by not having.
// So the pixels where it stands are compared against the pixels of the same
// corridor three tiles along.
//
// THE COMPARISON IS AGAINST THE HALLWAY, NOT AGAINST BLACK. The bloom that just
// ended revealed the whole hallway (`specs/sensing.md`: "the tiles it lit stay
// revealed"), so the ground the Flarefish stands on is remembered rather than
// unrevealed, and "black" is the wrong control. What the item asks is that its
// position looks like its surroundings, so the control is its surroundings: the
// same fixture, the same tile shape, the same visibility state, the same
// sub-tile offset, three tiles away. The hallway is emptied of plankton first
// (`room.ts`), so neither sample carries the faint mote a remembered corridor tile
// would otherwise be drawn with.
//
// IT IS POSED ONTO A NAMED TILE BEFORE THE READING, so both samples land on
// interior hallway tiles — corridor on both sides, rock above and below — rather
// than on whichever tile a patrol happened to reach. `setPredatorTile` "leaves its
// facing, its state and its `released` flag untouched" (`specs/instrumentation.md`),
// so nothing about the flare cycle moves with it.
//
// THE BLOOM IS THE CONTROL FOR "NOTHING". A build that draws no Flarefish at all,
// ever, would satisfy an unaccompanied "nothing is drawn here", so the reading a
// beat into the bloom asks the opposite question first: inside its own disc, where
// `specs/predators/flarefish.md` has "every predator and drifter inside the disc
// drawn live", it reports `lit`. Plainly there, then plainly gone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertNull } from "../assert";
import { FLARE_INTERVAL, TILE } from "../../src/constants";
import { captureReplay, createHarness, ticks, type Harness } from "../harness";
import { graded, sceneGuard, sceneHeld, unmetPrecondition } from "../scene";
import { startPlaying } from "../harness";
import { BLOOM_MAX, FIRST_FLARE_MAX, FLARE_POLL, poseFlareRoom } from "./room";

/**
 * How far apart the two samples may be drawn, as an RGB distance.
 *
 * The item's bound: `25` of the `441` (`sqrt(3) * 255`) that separates black from
 * white. Wide enough for dithering, a subtle noise texture or a hair of gradient
 * across a tile; far too narrow for a mote, a glow or a wavefront, any of which
 * would be the tell this hunter is defined by not carrying.
 */
const ALIKE_MAX_DISTANCE = 25;

/**
 * How far along the hallway the control sample is taken, in tiles.
 *
 * Three tiles is `96` logical units: three times the `32`-unit sprite cell
 * `specs/assets.md` gives a creature, so nothing drawn on the Flarefish's own body
 * reaches it, and still inside the same six-tile hallway, so it is the same
 * corridor in the same visibility state.
 */
const CONTROL_TILES = 3;

/** The hallway tile the Flarefish is posed on for the reading. */
const SAMPLE_HALL_INDEX = 1;

/**
 * How far into the bloom the "plainly there" control is read, in ticks.
 *
 * A fifth of a second of the `FLARE_BLOOM` (`1 s`) burn: past any tick a build
 * takes to light what its flag announced.
 */
const INTO_BLOOM = ticks(0.2);

/**
 * How long after the bloom ends the dark is read, in seconds.
 *
 * `specs/predators/flarefish.md` has "a short fade of the bloom art" play out from
 * the moment the bloom ends, "lighting nothing", and fixes no length for it. Two
 * seconds is generous to any reading of "short" and still five seconds clear of
 * the next charge-up, which `FLARE_INTERVAL` puts `7 s` after the bloom ended.
 */
const AFTER_FADE = 2;

/** Ticks run after the pose, so the board has been drawn where it now stands. */
const SETTLE_TICKS = 1;

/** A device pixel, as the harness hands one back. */
type Pixel = [number, number, number, number];

/** How far apart two pixels are in RGB, of the 441 that spans black to white. */
function distance(a: Pixel, b: Pixel): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows nothing of itself between flares, in what it reports and on the canvas", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const room = await poseFlareRoom(h);
    const guard = await sceneGuard(h, room.quiet);

    const bloom = await h.until(
      (snap) => snap.predators[room.index].flaring === true,
      { maxFrames: ticks(FIRST_FLARE_MAX), poll: FLARE_POLL },
    );
    if (!bloom.hit) {
      unmetPrecondition(
        `the Flarefish did not bloom within ${FIRST_FLARE_MAX} s of patrolling a ` +
          `sealed hallway, so there was no flare to watch it come out of — ` +
          `whether it flares on its interval is flarefish/flare-cadence's ` +
          `verdict, not this one's`,
      );
    }

    const watched = await captureReplay(h, "notell", async () => {
      // Plainly there: a beat into its own bloom, inside its own disc.
      await h.advance(INTO_BLOOM);
      const burning = h.snapshot();

      // Out the far side of the bloom, and well past its fade.
      const ended = await h.until(
        (snap) => snap.predators[room.index].flaring !== true,
        { maxFrames: ticks(BLOOM_MAX), poll: FLARE_POLL },
      );
      await h.advance(ticks(AFTER_FADE));

      // Onto a named interior tile of the hallway, so the pair of samples is the
      // same corridor twice rather than whichever tile a patrol reached.
      const home = room.hall[SAMPLE_HALL_INDEX];
      h.debug.setPredatorTile(room.index, home.tx, home.ty);
      await h.advance(SETTLE_TICKS);

      const after = h.snapshot();
      const fish = after.predators[room.index];
      const atFish = h.pixel(fish.x, fish.y);
      const control = h.pixel(fish.x + CONTROL_TILES * TILE, fish.y);
      return { burning, ended, after, atFish, control };
    });

    assertNull(sceneHeld(h.snapshot(), guard), "the scenario held to the end");

    // The control: it really was there, and really was drawn, a moment ago.
    const burning = watched.burning.predators[room.index];
    assertEqual(
      burning.flaring,
      true,
      `the Flarefish is still blooming ${INTO_BLOOM} ticks in, when the control ` +
        `reading is taken`,
    );
    assertEqual(
      burning.lit,
      true,
      "the Flarefish is drawn while its own bloom burns, which " +
        "specs/predators/flarefish.md gives to every predator inside the disc",
    );
    assertEqual(
      watched.ended.hit,
      true,
      `the bloom ended within ${BLOOM_MAX} s, so there is a quiet stretch to read`,
    );

    // What it reports, out in the dark between flares.
    const fish = watched.after.predators[room.index];
    assertEqual(
      fish.flaring,
      false,
      `the Flarefish's \`flaring\` ${AFTER_FADE} s after its bloom ended`,
    );
    assertEqual(
      fish.flareCharging,
      false,
      `the Flarefish's \`flareCharging\` ${AFTER_FADE} s after its bloom ended, ` +
        `of the ${FLARE_INTERVAL} s FLARE_INTERVAL puts before the next charge-up`,
    );
    assertEqual(
      fish.flareRadius,
      0,
      `the Flarefish's \`flareRadius\` ${AFTER_FADE} s after its bloom ended`,
    );
    assertEqual(
      fish.lit,
      false,
      `the Flarefish's \`lit\` while it stands eleven tiles from a forager at ` +
        `G = 0, with no flare, no sonar mark and no alert reaching it`,
    );

    // And what it leaves on the canvas.
    assertLessThanOrEqual(
      distance(watched.atFish, watched.control),
      ALIKE_MAX_DISTANCE,
      `the RGB distance, of 441, between the pixel where the Flarefish stands ` +
        `(${fish.tx}, ${fish.ty}) and the pixel ${CONTROL_TILES} tiles along the ` +
        `same hallway — no mote, glow or wavefront is left behind`,
    );
  });
});
