// presentation/hud-queued — the HUD draws the charge that loads on the next
// firing as that charge's core sprite.
//
// THE REQUIREMENT. `specs/ui.md` — "The HUD": "Queued | The charge that loads on
// the next firing, drawn as that charge's core and placed so it is never mistaken
// for the loaded one", one of the six readouts the HUD carries on `playing`.
// `specs/injector.md` says what the queued core is: "The injector holds a
// loaded core and a queued core", and "Firing moves the queued charge into the
// loaded slot".
//
// THE DRIVE. The same hall `presentation/hud-loaded` reads, and the other half of
// it: level 5 opened, the channel posed with garnet cores alone, halide loaded
// and cobalt queued. So cobalt is a charge no core on the channel carries and a
// different charge from the loaded one, which is what makes the two readouts two
// points: a build that draws one and not the other fails exactly one of them.
//
// HOW COBALT'S OWN SPRITE IS NAMED. By posing cobalt cores first and taking the
// produced 28 x 28 source the frame drew where the snapshot says they stand — see
// `./hud-charge.ts`. Identity and natural size, never a path, because
// `specs/assets.md` has every produced file resolved through the bundler and a
// bundler inlines a 28 x 28 PNG as a `data:` URI.
//
// WHY THE INJECTOR'S OWN DISC IS LEFT OUT. The same exclusion
// `presentation/hud-loaded` applies, for the same reason and by symmetry: a
// sprite inside the machine's own 36 units is the machine's picture of what it
// holds, and `specs/ui.md` puts the queued charge on the HUD, which "draws over
// the hall and hides none of them".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { coreDraws } from "./readouts";
import { identifyCharge, poseBlockOf, readoutDraws } from "./hud-charge";

/** The charge the injector holds loaded, which no core on the channel carries. */
const LOADED = "halide" as const;

/** The charge queued behind it, which no core on the channel carries either. */
const QUEUED = "cobalt" as const;

/** The charge every core on the channel carries. */
const ON_THE_CHANNEL = "garnet" as const;

/** What the injector holds while the sprites are being named. */
const WHILE_NAMING = ["garnet", "olivine"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the queued charge on the HUD as that charge's core", async () => {
  const cobalt = await identifyCharge(h, QUEUED, WHILE_NAMING);

  await poseBlockOf(h, ON_THE_CHANNEL, [LOADED, QUEUED]);
  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  const posed = await h.snapshot();
  assertEqual(
    posed.injector.queued,
    QUEUED,
    "the charge the injector holds queued",
  );
  assertEqual(
    posed.train.filter((core) => core.charge === QUEUED).length,
    0,
    `the ${QUEUED} cores standing on the channel`,
  );

  const readouts = readoutDraws(coreDraws(calls), cobalt, posed.train);
  assertGreaterThan(
    readouts.length,
    0,
    `draws of the ${QUEUED} core sprite on the HUD`,
  );
});
