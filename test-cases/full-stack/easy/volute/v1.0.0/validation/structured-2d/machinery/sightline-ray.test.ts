// machinery/sightline-ray — the sightline ray runs from the injector to its first core.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Sightline"): "While sightline is
// active a ray is drawn from the injector's center along the current aim
// heading. It ends where it first crosses the edge of a core, or at the field
// edge when it crosses none." `specs/injector.md` fixes the injector's center at
// `(420, 330)` and its opening aim at 270 degrees, "straight up the field", and
// `specs/channel.md` draws each core "as a disc of `CORE_RADIUS` (`14` units)".
// So a lone core whose center the aim passes through stops the ray 14 units
// short of that center — the review item's "the core's near edge".
//
// HOW THE RAY IS ISOLATED. Two halls, posed identically from the same seed and
// stepped the same number of ticks, one of them granted sightline. Everything
// the two draw is the same picture except the ray, so the pixels they differ in
// ARE the ray. `specs/ui.md` fixes no palette and no styling, and the HUD it
// specifies carries no machinery readout, so nothing here reads a colour: only
// whether a pixel changed when the machinery was granted.
//
// WHERE THE CORE IS PUT. Arc 2820, which `specs/channel.md`'s vertex table puts
// at `(420, 120)` on the leg from `(120, 120)` to `(840, 120)` — 210 units
// straight up from the injector, so the ray should end at 196. Two things follow
// from the choice. The aim crosses the channel plate at `(420, 220)` on the way,
// carrying no core, so a ray that stopped at the plate rather than at a core
// fails. And the head stands below the 4000 the danger threshold
// (`specs/progression.md`) sits at, so neither hall draws the field's danger
// warning and the two pictures cannot differ over an effect this point is not
// about.
//
// THE TOLERANCES. The span's end is read against 196 within +/- 3 units, the
// figure the review item states: a drawn line has width and a round cap, and a
// core's rim is anti-aliased, so the last pixel that changed sits within a
// pixel or two of the geometric edge either way. It is far tighter than the 14
// units that separate the near edge from the center, and than the 134 that
// separate it from the field edge a ray meeting nothing would run to. A gap of
// up to 60 units is allowed inside the span, which is wider than a channel plate
// — `specs/channel.md` draws it "wide enough to carry a core", 28 units — so a
// build that draws the ray beneath the plate rather than over it is not failed
// for a drawing order the specs leave open. Beyond the core nothing may differ
// at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertNear, assertTrue } from "../assert";
import {
  ANGLE_TOL,
  CORE_RADIUS,
  INJECTOR,
  INJECTOR_RADIUS,
  OPENING_AIM,
  RAY_END_TOL,
  SPACING,
  type Point,
} from "../constants";
import {
  alongAim,
  captureStill,
  channelPoint,
  createHarness,
  fieldPixels,
  head,
  poseHall,
  type Harness,
  type PixelRect,
} from "../harness";

/** The level the hall opens on; the ray is the same on every level. */
const LEVEL = 1;

/** The lone core: `(420, 120)`, straight up the opening aim from the injector. */
const CORE_S = 2820;

/** Where the sampling starts, just outside the injector's own 22-unit body. */
const SAMPLE_FROM = INJECTOR_RADIUS + 4;

/** Where it stops, a little inside the top edge of the 540-unit field. */
const SAMPLE_TO = 320;

/** How long a break inside the span is forgiven: wider than a channel plate. */
const SPAN_GAP = 60;

/** A channel to a pixel: how far two frames' channels must part to count. */
const CHANNEL_TOL = 6;

/** The half-width of the block sampled at each step along the ray. */
const BLOCK = 2;

/** How many pixels of that block must part for the step to count as drawn. */
const BLOCK_MIN = 2;

let lit: Harness;
let dark: Harness;

beforeEach(async () => {
  lit = await createHarness();
  dark = await createHarness();
});

afterEach(async () => {
  await lit.dispose();
  await dark.dispose();
});

/** Pose the same hall on a harness, with or without the sightline granted. */
async function poseSameHall(h: Harness, sightline: boolean): Promise<void> {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: [[CORE_S, "halide", null]],
    ...(sightline ? { machinery: "sightline" as const } : {}),
  });
  await h.step();
}

/** Whether two frames part over the block centred on a field point. */
function parts(a: PixelRect, b: PixelRect, at: Point): boolean {
  let differing = 0;
  for (let dy = -BLOCK; dy <= BLOCK; dy += 1) {
    for (let dx = -BLOCK; dx <= BLOCK; dx += 1) {
      const x = Math.round(at.x) + dx;
      const y = Math.round(at.y) + dy;
      if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue;
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        if (Math.abs(a.data[i + c] - b.data[i + c]) > CHANNEL_TOL) {
          differing += 1;
          break;
        }
      }
    }
  }
  return differing >= BLOCK_MIN;
}

/**
 * Where the ray first crosses the core's edge, along the aim the hall reports.
 *
 * The ray-disc crossing `specs/machinery.md` names, so a build whose aim sits a
 * fraction off 270 is measured against the edge its own ray actually meets.
 * Negative when the aim misses the core altogether.
 */
function edgeDistance(aim: number, centre: Point): number {
  const far = alongAim(aim, 1, INJECTOR);
  const ux = far.x - INJECTOR.x;
  const uy = far.y - INJECTOR.y;
  const mx = centre.x - INJECTOR.x;
  const my = centre.y - INJECTOR.y;
  const along = mx * ux + my * uy;
  const across = Math.hypot(mx, my) ** 2 - along * along;
  if (across > CORE_RADIUS * CORE_RADIUS) return -1;
  return along - Math.sqrt(CORE_RADIUS * CORE_RADIUS - across);
}

it("draws the aim ray from the injector out to the near edge of its first core", async () => {
  await poseSameHall(dark, false);
  await poseSameHall(lit, true);
  captureStill(lit, "ray");

  const shown = lit.snapshot();
  assertAngleNear(
    shown.injector.aim,
    OPENING_AIM,
    ANGLE_TOL,
    "the aim a hall opens on (specs/injector.md), which the ray is read along",
  );

  const centre = channelPoint(head(shown).s);
  const edge = edgeDistance(shown.injector.aim, centre);
  assertTrue(edge > 0, "the aim the hall reports crosses the posed core");

  const withRay = fieldPixels(lit);
  const without = fieldPixels(dark);

  // Walk out along the aim and find where the two frames stop parting.
  let start = -1;
  let end = -1;
  for (let r = SAMPLE_FROM; r <= SAMPLE_TO; r += 1) {
    if (!parts(withRay, without, alongAim(shown.injector.aim, r, INJECTOR))) {
      continue;
    }
    if (start < 0) start = r;
    if (end < 0 || r - end <= SPAN_GAP) end = r;
    else break;
  }

  assertTrue(
    start > 0,
    "a span of pixels the sightline changed, along the aim",
  );
  assertNear(
    end,
    edge,
    RAY_END_TOL,
    `where that span ends, against the core's near edge ${CORE_RADIUS} units short of its center`,
  );

  // And nothing at all past the core, so the ray stopped at it rather than
  // carrying on through: the two frames are otherwise the same picture.
  for (
    let r = Math.ceil(edge) + SPACING + RAY_END_TOL;
    r <= SAMPLE_TO;
    r += 1
  ) {
    assertTrue(
      !parts(withRay, without, alongAim(shown.injector.aim, r, INJECTOR)),
      `the frames stand unchanged ${r} units out, past the core the ray met`,
    );
  }
});
