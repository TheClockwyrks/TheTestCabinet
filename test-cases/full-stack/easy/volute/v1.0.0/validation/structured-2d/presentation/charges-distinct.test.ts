// presentation/charges-distinct — each of the five charges is drawn from a
// produced core sprite of its own.
//
// THE REQUIREMENT. `specs/assets.md` — the asset table fixes "core, one per
// charge | 28 x 28 | 5", so the five charges are five produced files, and a core
// standing on the channel is drawn from the file its own charge names.
// `specs/overview.md` — "The charges": every charge "carries a glyph of its own",
// which is a mark on that charge's own file.
//
// WHAT IS READ. The draw operations one frame submitted, and no colour:
// `specs/ui.md` — "Presentation": "Volute fixes no palette, no font, no layout,
// and no styling for any screen", so how a build draws a charge is the reviewer's
// to judge. What is read here is the IDENTITY of the produced source drawn at
// each posed core — the reading `presentation/produced-core-sprites` takes of one
// core, taken over all five at once — and that those five identities are five
// sources rather than fewer.
//
// THE TOLERANCE. `SPRITE_CENTRE_TOL`. `specs/channel.md` draws a core as "a disc
// of `CORE_RADIUS` (`14` units) centered on the point its arc position gives" and
// `specs/assets.md` has the sprite fill its 28 x 28 canvas, so sprite and core
// share a centre. Half a sprite of slack takes rounding and whatever framing a
// build draws around a core, and the posed cores stand 120 units apart, so no
// core can claim its neighbour's sprite.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_IDS, SPRITE_CENTRE_TOL } from "../constants";
import { assertEqual, assertNotNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseFiveCharges } from "./charges";
import { coreDraws, spriteAt } from "./readouts";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each of the five charges from a produced core sprite of its own", async () => {
  await poseFiveCharges(h);
  captureStill(h, "charges");

  const drawn = coreDraws(h.lastCalls());
  const posed = h.snapshot();
  assertEqual(
    posed.train.length,
    CHARGE_IDS.length,
    "the cores one core of each charge put on the channel",
  );

  const sources: number[] = [];
  for (const core of posed.train) {
    const id = spriteAt(drawn, { x: core.x, y: core.y }, SPRITE_CENTRE_TOL);
    assertNotNull(
      id,
      `a produced 28 x 28 sprite drawn at the ${core.charge} core`,
    );
    sources.push(id as number);
  }

  assertEqual(
    new Set(sources).size,
    CHARGE_IDS.length,
    "the distinct produced sources the five cores were drawn from",
  );
});
