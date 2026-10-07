// presentation/aperture-turns-while-the-run-is-paused — a stopped run does not stop
// the apertures.
//
// THE RULE is `specs/ui.md` on what a frame always does — "`state.simTime`
// accumulates the frame's delta time ON EVERY UPDATE, WHATEVER THE SCREEN, and
// input is read on every screen" — read against `specs/assets.md`, which hangs the
// aperture on that figure alone: "Each rise and each set on the field draws frame
// `floor(state.simTime / APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own
// sheet ... SO BOTH APERTURES TURN CONTINUOUSLY." Nothing in either sentence
// mentions `sim.status`, and `specs/instrumentation.md` says the same of the field
// itself: "`simTime` accumulates the delta time of every update, whatever the
// screen."
//
// The run's own clock is the thing that stops. `specs/simulation.md`: "The fraction
// advances only while the status is `running`, so pausing holds it where it is." So
// a paused run is the sharpest place to read the rule: one figure must move while
// the other stands still, on the same frames.
//
// THE PAUSE IS POSED THROUGH THE SURFACE. `setPaused(paused)` "Moves `sim.status`
// between `running` and `paused`, exactly as the `play` toggle moves it"
// (`specs/instrumentation.md`), so what is read is a genuinely paused run rather
// than a screen the run was never started on.
//
// THE CLOCK IS DRIVEN TO THE MIDDLE OF EACH FRAME TIME, half a frame time from
// either edge, because the aperture's index turns on a floor of a running sum and
// those sums "agree to within the rounding of that sum rather than bit for bit".
// Six samples take the sheet once round, and each names the file the formula does —
// `Harness.imagePixels` and `sameAsDrawn` against the committed frames, because a
// path proves nothing when a bundler may inline a produced PNG.
//
// THE WORLD IS ONE RISE ON AN EMPTY FIELD, so there is nothing for the held run to
// have advanced even if it had been running: the point is that the aperture turned,
// not that the machine did.
//
// THE VERDICT. Across six frame times the run's status stays `paused` and its
// fraction stays where it was, while `simTime` accumulates and the rise walks its
// six frames in order.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNear,
  fail,
} from "../assert";
import {
  APERTURE_FRAMES,
  APERTURE_FRAME_TIME,
  APERTURE_SPRITE_SIZE,
  FRACTION_TOLERANCE,
} from "../constants";
import { distance, hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  imageDraws,
  openBareRun,
  placeRise,
  type Harness,
} from "../harness";
import { RISE_SPRITES } from "../assets/files";
import { decodeProduced, sameAsDrawn, type Sprite } from "../assets/sprites";

/** How near a sprite's centre must land to count as drawn on a hex. */
const ON_POINT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("walks the aperture through its six frames while the run stays paused", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });
  await placeRise(h, 0, ORIGIN, 0);

  const readings = await decodeProduced(RISE_SPRITES);
  const frames: Sprite[] = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(
        `a decoded ${RISE_SPRITES[index]?.label ?? "rise frame"}`,
        read.reason,
      );
    }
    return read.sprite;
  });

  /** Which numbered frame of the sheet the aperture on the anchor hex is showing. */
  const shown = async (): Promise<number> => {
    const centre = hexCenter(ORIGIN);
    const seen: number[] = [];
    for (const draw of imageDraws(await h.lastCalls())) {
      if (draw.image.width !== APERTURE_SPRITE_SIZE) continue;
      if (distance({ x: draw.cx, y: draw.cy }, centre) > ON_POINT) continue;
      const pixels = await h.imagePixels(draw.image.id);
      if (pixels === null) continue;
      const found = frames.findIndex((frame) => sameAsDrawn(frame, pixels));
      if (found >= 0) seen.push(found);
    }
    assertLength(
      seen,
      1,
      "the rise shows exactly one frame of its sheet at a time",
    );
    return seen[0] ?? -1;
  };

  const held = await h.snapshot();
  assertEqual(
    held.sim?.status,
    "paused",
    "the run is paused before any frame runs",
  );
  const fraction = held.sim?.fraction ?? -1;
  const started = held.simTime;

  await captureReplay(h, "paused", async () => {
    for (let k = 0; k < APERTURE_FRAMES; k += 1) {
      const target = (k + 0.5) * APERTURE_FRAME_TIME;
      const now = (await h.snapshot()).simTime;
      assertGreaterThan(
        target,
        now,
        `simTime has not yet passed the middle of aperture frame ${String(k)}`,
      );
      await h.advanceSeconds(target - now, 1);

      const at = await h.snapshot();
      assertEqual(
        at.sim?.status,
        "paused",
        "the run is still paused, so nothing of the machine has advanced",
      );
      assertNear(
        at.sim?.fraction ?? -1,
        fraction,
        FRACTION_TOLERANCE,
        "and the fraction is held where the pause left it",
      );
      assertEqual(
        Math.floor(at.simTime / APERTURE_FRAME_TIME),
        k,
        "while simTime accumulates the delta of every update whatever sim.status is",
      );
      assertEqual(
        await shown(),
        k % APERTURE_FRAMES,
        "so the aperture goes on drawing the frame simTime names, behind a stopped run",
      );
    }
  });

  const ended = await h.snapshot();
  assertGreaterThan(
    ended.simTime,
    started + APERTURE_FRAME_TIME * (APERTURE_FRAMES - 1),
    "the frames driven really covered six aperture frame times",
  );
});
