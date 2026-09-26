// lanternjaw/additive-reveal — lighting it leaves the bulb where it was.
//
// specs/predators/lanternjaw.md: "A reveal is additive: when the forager's light or
// a flare falls on the creature, the bulb neither moves nor changes, and only what
// hangs beneath it tells the two apart." That is a claim about two readings of the
// same creature on the same tile, so the scenario takes both without moving
// anything: the bulb before the light reaches it, and the bulb once it has.
//
// THE LIGHT IS THE ONLY THING THAT CHANGES. The pair stands four tiles apart, 128
// units: outside `V` at `G = 0` (`VISION_MIN`, 96) and inside `V` at `G = 1`
// (`VISION_MIN + VISION_GAIN`, 160), on one straight corridor so the light's own
// line-of-sight rule is satisfied at both readings. Turning `G` up is the whole of
// the change between the two frames.
//
// AND THE HUNTER IS HELD STILL. 128 units is inside the 320 a Lanternjaw reaches at
// `G = 1`, so a lit hunter would take a fix and charge, and "found in the same
// place" would be measuring a moving creature. `setPredatorMind(index, false)`
// holds it exactly where it stands and leaves the rest of the simulation running
// (specs/instrumentation.md), so the two frames differ in the light and nothing
// else. What the hunter does with a fix is `lanternjaw/light-range`'s and
// `lanternjaw/wander-disguise`'s.
//
// WHAT "CLEAR OF THE MOTE" MEANS, AND WHAT IT CAN SAY. The surroundings are read
// on a ring further out than the mote's own profile reaches, so the two readings
// do not overlap: the mote is the inner samples, the surroundings are the ring
// beyond them. What that ring can decide is the fog/not-fog crossing rather than a
// body's outline, because nothing in the specification fixes how large a mote's
// glow is or how large a creature is drawn — on a build whose sprite is no wider
// than its own glow there is no radius at which one exists without the other. So
// the ring is asked the question it can answer: it was the flat unrevealed fog
// specs/overview.md caps, and once the light falls on the creature it visibly is
// not. The body itself is read off `lit`, which specs/predators.md defines as
// whether the body is being drawn this instant.
//
// AND WHY THE MOTE IS READ AT ONE PLACE RATHER THAN MEASURED TWICE. The obvious
// reading of "found in the same place" is to locate the mote in each frame and
// compare, and it is the wrong one. A reveal that is genuinely ADDITIVE sums the
// bulb's light with the body's, and both are bright, so the middle of a revealed
// creature saturates: the mote's own core is then indistinguishable from the body
// around it and has no recoverable center at all. A check that located "the mote"
// in the lit frame would be locating the body's brightest blob, and would fail a
// conforming build that draws its bulb anywhere but the body's middle — which the
// specification expressly allows, calling it "a bulb on a bell". So the mote is
// found ONCE, in the frame where it is the only thing drawn, and the lit frame is
// asked whether the amber light is still there at that same place. What a reviewer
// gets besides is the recorded clip, which shows the body arriving around an
// unmoved bulb far better than any pixel bound could state it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import { BRIGHT_HOLD, VISION_GAIN, VISION_MIN } from "../constants";
import { poseSightLine, spawnPredator } from "../fixtures";
import {
  captureReplay,
  colorDistance,
  createHarness,
  luminance,
  MOTE_RADII,
  poseBrightness,
  sampleRing,
  startPlaying,
  type Harness,
} from "../harness";
import {
  fromForager,
  parkForager,
  requireSceneHeld,
  sceneGuard,
} from "../scene";
import { brightestWarm, moteCenter, moteProfileAt, warm } from "./motes";

/**
 * How far apart the pair stands, in tiles.
 *
 * Four is 128 units, between `V` at `G = 0` (96) and `V` at `G = 1` (160), with a
 * tile of margin either side so neither reading turns on a unit.
 */
const GAP_TILES = 4;

/** Spare corridor beyond each of them, so the pose is not against rock. */
const LEAD_TILES = 1;
const TAIL_TILES = 2;

/**
 * Where the body is read, in logical units out from the mote's own drawn center.
 *
 * Beyond the outermost radius the mote profile reads, so the body sample and the
 * mote sample never overlap, and still well inside the tile the creature stands
 * on.
 */
const BODY_RADIUS = Math.max(...MOTE_RADII) + 4;

/**
 * The brightest an unrevealed tile may be drawn at, per mean channel.
 *
 * specs/overview.md caps unrevealed fog at "a tenth of full brightness", 25.5 of
 * 255. The ring is under that cap before the light reaches the creature, which is
 * what makes the reading below a change FROM fog rather than between two lit
 * frames.
 */
const FOG_CEILING = 25.5;

/**
 * The sensing floor the ring owes once the light falls on the creature, as an
 * RGB distance out of the 441 that separates black from white.
 *
 * `8` of `441` is the level below which a sampling cannot tell a drawing from
 * eight-bit channel rounding and the host's antialiasing. Anything the build
 * painted there clears it, in whatever palette and however dim.
 *
 * So a ring that has moved further than that has stopped being the fog it was,
 * and how boldly the build drew the body over it is the build's.
 */
const CHANGED_MIN = 8;

/** A beat either side of the change, in ticks, so nothing is read on the tick it flipped. */
const SETTLE_TICKS = 2;

/** Ticks run after the readings, purely so the clip holds on the revealed body. */
const CLIP_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Lighting it leaves the bulb where it was", async () => {
  await startPlaying(h);
  const line = await poseSightLine(h, GAP_TILES, {
    lead: LEAD_TILES,
    tail: TAIL_TILES,
  });
  const index = await spawnPredator(h, "lanternjaw", line.pred, {
    state: "wander",
    mind: false,
  });
  await parkForager(h, line.forager);
  const watch = await sceneGuard(h);

  const read = await captureReplay(h, "reveal", async () => {
    await h.advance(SETTLE_TICKS);
    const dark = h.snapshot();
    const unlitAt = dark.predators[index];
    const darkCenter = moteCenter(h, unlitAt.x, unlitAt.y);
    const darkProfile = moteProfileAt(h, darkCenter);
    const darkBody = sampleRing(h, darkCenter.x, darkCenter.y, BODY_RADIUS);

    // The light comes up and reaches the creature. Nothing else is touched.
    await poseBrightness(h, 1, BRIGHT_HOLD);
    await h.advance(SETTLE_TICKS);
    const shown = h.snapshot();
    const litAt = shown.predators[index];
    const litProfile = moteProfileAt(h, darkCenter);
    const litBody = sampleRing(h, darkCenter.x, darkCenter.y, BODY_RADIUS);

    await h.advance(CLIP_TICKS);
    return {
      dark,
      shown,
      darkCenter,
      darkProfile,
      litProfile,
      darkBody,
      litBody,
      gap: fromForager(shown, litAt.x, litAt.y),
      end: h.snapshot(),
    };
  });

  requireSceneHeld(read.end, watch);

  // The fixture's own geometry: the creature stands outside the light at the
  // first reading and inside it at the second, so the light is what changed.
  assertGreaterThan(
    read.gap,
    VISION_MIN,
    `the units between the two centers against V at G 0 (VISION_MIN, ` +
      `${VISION_MIN}), which the creature stands beyond`,
  );
  assertLessThan(
    read.gap,
    VISION_MIN + VISION_GAIN,
    `the units between the two centers against V at G 1 (VISION_MIN + ` +
      `VISION_GAIN, ${VISION_MIN + VISION_GAIN}), which the creature stands ` +
      "inside",
  );
  // And inside the light the BUILD reports, because a light that never reached
  // the hunter revealed nothing for this point to read.
  assertGreaterThan(
    read.shown.visionRadius,
    read.gap,
    `the light radius the build reported at G = 1, against the ` +
      `${read.gap.toFixed(1)} units the Lanternjaw stood away`,
  );

  assertEqual(
    read.dark.predators[index].lit,
    false,
    "whether the Lanternjaw's body is drawn before the light reaches it",
  );
  assertEqual(
    read.shown.predators[index].lit,
    true,
    "whether the Lanternjaw's body is drawn once the light reaches it",
  );

  // The bulb: still amber, and still amber where it was.
  assertNotNull(
    brightestWarm(read.darkProfile),
    "a warm sample in the mote's profile before the light reached it, read " +
      `about the (${read.darkCenter.x.toFixed(1)}, ${read.darkCenter.y.toFixed(1)}) ` +
      "the mote was drawn at",
  );
  const litMote = brightestWarm(read.litProfile);
  assertNotNull(
    litMote,
    "a warm sample in the mote's profile once the light has reached it, read " +
      "about the same place the mote was drawn at unlit — the reveal adds the " +
      "body without taking the bulb away",
  );
  assertEqual(
    warm((litMote as NonNullable<typeof litMote>).color),
    true,
    "the lit mote still reads red-leaning, its red channel above its blue",
  );

  // And the body: fog before, drawn after, read clear of the mote.
  assertLessThanOrEqual(
    luminance(read.darkBody),
    FOG_CEILING,
    `the mean channel ${BODY_RADIUS} units out from the mote before the light ` +
      "reached it, which is the unrevealed fog specs/overview.md caps at a " +
      "tenth of full brightness",
  );
  assertGreaterThan(
    colorDistance(read.litBody, read.darkBody),
    CHANGED_MIN,
    `the RGB distance, out of 441, the ring ${BODY_RADIUS} units out from the ` +
      "mote moved when the light fell on the creature: mean channel " +
      `${luminance(read.litBody).toFixed(1)} against the ` +
      `${luminance(read.darkBody).toFixed(1)} of fog it was`,
  );
});
