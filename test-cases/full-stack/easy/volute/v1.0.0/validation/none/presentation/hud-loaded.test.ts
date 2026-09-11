// presentation/hud-loaded — the HUD draws the charge the injector holds loaded
// as that charge's core sprite.
//
// THE REQUIREMENT. `specs/ui.md` — "The HUD": "Loaded | The charge the injector
// holds, drawn as that charge's core", one of the six readouts the HUD carries on
// `playing`.
//
// THE DRIVE. Level 5 is opened, the one level whose charge set holds all five
// (`specs/progression.md`), and the channel is posed with garnet cores alone
// while `setLoaded` puts halide in the injector and `setQueued` cobalt behind it
// (`specs/instrumentation.md`: "Sets the core the injector holds loaded, and the
// one it holds queued, to `charge`"). So halide is a charge no core on the
// channel carries, and its sprite appearing on the field can only be the HUD
// saying what is loaded.
//
// HOW HALIDE'S OWN SPRITE IS NAMED. By posing halide cores first and taking the
// produced 28 x 28 source the frame drew where the snapshot says they stand — see
// `./hud-charge.ts`. A sprite is identified by identity and natural size and
// never by a path, since `specs/assets.md` has the build resolve every produced
// file through the bundler and a bundler inlines a 28 x 28 PNG as a `data:` URI.
// Identity holds for the life of the page, so the sprite named on the first pose
// is the one looked for on the second.
//
// WHY THE INJECTOR'S OWN CORE DOES NOT COUNT. `specs/ui.md` draws the live hall
// with "the injector at its fixed position with the direction it is aimed
// readable and the core it holds", so the loaded charge's sprite is on the
// machine whether or not the HUD carries it. The same file's HUD table separates
// the two, and separates them AS A DISTANCE: the Loaded readout "is drawn with
// its center further from the injector center than the injector radius and
// `CORE_RADIUS` together". That is 22 + 14 = 36 units from `(420, 330)`
// (`specs/injector.md`, `specs/channel.md`), so a draw whose centre is inside
// that is the machine's own picture and is left out. THIS POINT THEREFORE JUDGES
// PLACEMENT, and only the placement that sentence fixes — see `./hud-charge.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { coreDraws } from "./readouts";
import { identifyCharge, poseBlockOf, readoutDraws } from "./hud-charge";

/** The charge the injector holds loaded, which no core on the channel carries. */
const LOADED = "halide" as const;

/** The charge behind it, which no core on the channel carries either. */
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

it("draws the loaded charge on the HUD as that charge's core", async () => {
  const halide = await identifyCharge(h, LOADED, WHILE_NAMING);

  await poseBlockOf(h, ON_THE_CHANNEL, [LOADED, QUEUED]);
  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  const posed = await h.snapshot();
  assertEqual(
    posed.injector.loaded,
    LOADED,
    "the charge the injector holds loaded",
  );
  assertEqual(
    posed.train.filter((core) => core.charge === LOADED).length,
    0,
    `the ${LOADED} cores standing on the channel`,
  );

  const readouts = readoutDraws(coreDraws(calls), halide, posed.train);
  assertGreaterThan(
    readouts.length,
    0,
    `draws of the ${LOADED} core sprite on the HUD`,
  );
});
