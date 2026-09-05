// assets/particles-played-through-runtime — the effects are the runtime's, not
// the build's.
//
// THE RULE, from The particle effects of `specs/assets.md`: "Play them through
// `@clockwyrks/particle-runtime`, an installed dependency imported by its bare
// name, using its `./canvas` binding: a player is constructed over a parsed
// system and a 2D rendering context and advanced each frame with that frame's
// delta, and it simulates the system and composites the particles itself. Its
// options carry the seed, the composite mode, and whether the context is cleared
// before compositing, and the package's own types are the authoritative API."
//
// WHY IT IS ASKED. `particle-2d` authors a system as data, and what turns that
// data into moving particles is the runtime: emitters, forces, curves, sub-
// emitters and the compositing are all its. A build that wrote a simulator of its
// own would be showing a picture its `system.json` does not describe, and every
// point that reads a produced system as the thing the game plays would be reading
// a file the game ignores. "Each play of a system varies, and that variation is
// correct" is the runtime's seeded randomness, not the build's.
//
// WHAT IT READS. The build's own source, for the bare specifier
// `@clockwyrks/particle-runtime/canvas` in any of the forms an import takes —
// static, dynamic, or `require`. The import is a fact about the source, so it is
// read where it is written; a binding only a test file imports plays nothing on a
// field and does not count.
//
// WHY THE BARE NAME MATTERS, AND IS PART OF THE SENTENCE. "an installed
// dependency imported by its bare name": a copy of the runtime vendored into the
// build's own tree and imported by a relative path is a fork, which drifts from
// the package the produced systems were authored against and which the case's own
// points play them through.
//
// WHAT THIS POINT DOES NOT READ. Whether each system is a system the runtime
// accepts is the three `*-system-produced` points; where and when an effect is
// fired, and that it sits over the frame at its event's position, are the
// presentation category's.
//
// THE EVIDENCE is a delivery driven for real — one set consuming one accepted
// constellation, which is the event the Delivery row fires on — so the frames the
// build drew while the effect played are recorded beside the verdict.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { FRAMES_PER_CYCLE } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  openBareRun,
  placeSet,
  resumeRun,
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";
import {
  CANVAS_BINDING,
  sourcesImportingCanvasBinding,
} from "./runtime-import";

/** Which of the challenge's products the set on `ORIGIN` receives. */
const PRODUCT = 0;

/** How many cycles the delivery is given to happen in. */
const CYCLES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays its particle systems through the runtime's canvas binding", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });
  await placeSet(h, PRODUCT, ORIGIN, 0);
  await spawnMote(h, ORIGIN, "sol");
  assertEqual(
    tallyOf(await h.snapshot(), PRODUCT),
    0,
    "nothing has been delivered before the run advances",
  );

  const delivered = await captureReplay(h, "delivery", async () => {
    await resumeRun(h);
    for (let frame = 0; frame < CYCLES * FRAMES_PER_CYCLE; frame += 1) {
      await advanceFraction(h, 1 / FRAMES_PER_CYCLE, 1);
      if ((tallyOf(await h.snapshot(), PRODUCT) ?? 0) > 0) break;
    }
    await h.advance(FRAMES_PER_CYCLE);
    return tallyOf(await h.snapshot(), PRODUCT) ?? 0;
  });

  assertEqual(
    delivered,
    1,
    "the set consumed its constellation, which is the event the delivery system is fired at",
  );

  assertGreaterThan(
    sourcesImportingCanvasBinding().length,
    0,
    `source modules of this build that import ${CANVAS_BINDING} by its bare name`,
  );
});
