// presentation/aperture-frame-follows-sim-time — the frame an aperture shows is the
// one `simTime` names, and the six run in order and wrap.
//
// THE RULE, stated under `specs/assets.md`'s sheet table: "Each rise and each set
// on the field draws frame
// `floor(state.simTime / APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own
// sheet, centered on its anchor hex, under the pattern the build draws in code, SO
// BOTH APERTURES TURN CONTINUOUSLY. `APERTURE_FRAME_TIME` is `0.12`." The sheet
// itself is numbered: the frames are "emitted as separate PNGs numbered from `0`",
// `0.png` to `5.png`, and `APERTURE_FRAMES` is `6`.
//
// So the formula names a FILE, and the check reads exactly that. `simTime` is what
// the snapshot reports — "Accumulated simulation time, in seconds",
// "`simTime` accumulates the delta time of every update, whatever the screen"
// (`specs/instrumentation.md`) — and `Harness.imagePixels` with `sameAsDrawn`
// says which committed file the frame drew, because a path proves nothing when a
// bundler may inline a produced PNG as a `data:` URI.
//
// THE CLOCK IS DRIVEN TO THE MIDDLE OF EACH FRAME TIME. The frame index turns on a
// floor, so a sample taken exactly on a boundary would turn on the last bit of a
// running sum — and `specs/instrumentation.md` says those sums "agree to within the
// rounding of that sum rather than bit for bit". Each sample is therefore driven to
// `(k + 0.5) * APERTURE_FRAME_TIME`, half a frame time from either edge, and the
// span driven is computed from the `simTime` the build itself reports.
//
// TWELVE SAMPLES, WHICH IS TWO TURNS. Six would show the six frames; twelve show
// them running in order AND wrapping — `mod APERTURE_FRAMES` — so a build that ran
// its sheet once and stopped, or that ran it backwards, or that held on the last
// frame, fails.
//
// THE WORLD IS ONE RISE IN THE EDITOR: no run is started, so nothing spawns, moves
// or is consumed across the one and a half seconds the clock is driven, and the
// only sprite on the aperture canvas is the one under test.
//
// THE VERDICT. At each of the twelve samples the rise draws
// `assets/sprites/apertures/rise/<k mod 6>.png`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength, fail } from "../assert";
import {
  APERTURE_FRAMES,
  APERTURE_FRAME_TIME,
  APERTURE_SPRITE_SIZE,
} from "../constants";
import { distance, hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  imageDraws,
  openChallengeDocument,
  placeRise,
  type Harness,
} from "../harness";
import { RISE_SPRITES } from "../assets/files";
import { decodeProduced, sameAsDrawn, type Sprite } from "../assets/sprites";

/** How near a sprite's centre must land to count as drawn on a hex. */
const ON_POINT = 6;

/** Two whole turns of the sheet, so the wrap is watched as well as the order. */
const SAMPLES = APERTURE_FRAMES * 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws frame floor(simTime / 0.12) mod 6 of the rise sheet, twice round", async () => {
  await openChallengeDocument(h, BARE);
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
  assertLength(
    frames,
    APERTURE_FRAMES,
    "the rise sheet holds six numbered frames",
  );

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

  await captureReplay(h, "cycle", async () => {
    for (let k = 0; k < SAMPLES; k += 1) {
      // Half a frame time into frame `k`, so the floor is not read on its edge.
      const target = (k + 0.5) * APERTURE_FRAME_TIME;
      const now = (await h.snapshot()).simTime;
      assertGreaterThan(
        target,
        now,
        `simTime has not yet passed the middle of aperture frame ${String(k)}`,
      );
      await h.advanceSeconds(target - now, 1);

      const at = (await h.snapshot()).simTime;
      assertEqual(
        Math.floor(at / APERTURE_FRAME_TIME),
        k,
        `the clock stands inside frame time ${String(k)}, so the formula names frame ${String(k % APERTURE_FRAMES)}`,
      );
      assertEqual(
        await shown(),
        k % APERTURE_FRAMES,
        `the rise draws frame floor(simTime / ${String(APERTURE_FRAME_TIME)}) mod ${String(APERTURE_FRAMES)} of its own sheet`,
      );
    }
  });
});
