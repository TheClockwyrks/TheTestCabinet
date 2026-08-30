// Arc Foundry — effects/aura-pulse-is-the-produced-system: the mark at an aura
// source is the file the run produced.
//
// THE REQUIREMENT, from `specs/assets.md`. The aura pulse is one of the twelve
// systems the run authors with `particle-2d`: "| Aura pulse | `fx/aura.json` | A
// structure carrying an aura stands on the yard | A slow pulse ring at the source,
// marking the aura it projects |". It is played where the event is — "the aura
// pulse at its source" — and the file closes with the rule that decides this point:
// "Everything the game shows or plays traces either to a file produced with one of
// the six tools or to one of the code-drawn elements above." The aura pulse is not
// among the code-drawn elements, so the mark at an aura source has to BE the
// produced system.
//
// WHY THE SIBLING POINT CANNOT DECIDE IT. `effects/aura-pulse` asks whether the
// ground around a Regulator moves where the ground around a Capacitor does not,
// which is a true and separate requirement — and a ring the build animates in code
// satisfies it perfectly. A repository that produced all twelve systems, shipped
// them, and then drew this one in code passes every other point in this category
// while the file it made is never played.
//
// SO ONE FILE IS WITHHELD. The harness's `withhold` keeps one produced file out of
// the page, in both of the shapes a built site can carry it in, and everything else
// the run produced still arrives. The same arrangement is read twice, and a build
// that plays the system loses the mark where a build that draws it in code keeps it.
//
// WHAT THIS READING CANNOT REACH UNDER THIS RUNTIME, stated plainly because the
// point is graded on it. An engineless build bundles its own files, and a build
// that imports a produced system as a module carries it as parsed source: it is on
// no request and inside no response, so withholding it reaches nothing and this
// reading cannot tell that build's pulse from a drawn one. The assertion is
// therefore written so that a build out of its reach PASSES: it only ever fails a
// build whose mark survives the file being taken away.
//
// WHAT IT IS COMPARED AGAINST, AND WHY IT IS NOT ZERO. The withheld reading is held
// against a Capacitor standing on the same anchor with everything served — a
// structure `specs/components.md` gives no aura at all. That is what "nothing is
// drawn there" means without asking the rest of the build to be perfectly still:
// whatever a build animates near a structure for its own reasons is in both
// readings, and only a mark that survives its system going missing is not. A build
// that marks nothing at all passes here and fails `effects/aura-pulse`, which is
// the point of keeping the two separate.
//
// THE RING IS READ OUTSIDE THE FOOTPRINT, for the reason its sibling gives: the
// Regulator also carries a produced idle cycle drawn on its `2` by `2` mount, and a
// reading inside the footprint would be about that cycle rather than about the
// aura. The window opens after the pulse has had time to cross the ring.

import { afterEach, it } from "vitest";

import { assertLessThanOrEqual } from "../assert";
import { structureCenter, type ComponentType } from "../constants";
import {
  captureStill,
  createHarness,
  emptyYard,
  openYard,
  standComponent,
  ticks,
  type Harness,
} from "../harness";
import { annulus, motion } from "./region";

/** The one produced file this point withholds, at the path `specs/assets.md` fixes. */
const AURA_SYSTEM = "fx/aura.json";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 24, row: 17 };

/** Outside the `2` by `2` footprint, inside the Scrap aura radius of `90`. */
const POINTS = annulus(structureCenter(ANCHOR.col, ANCHOR.row), 26, 60, 4);

/** Long enough for a pulse raised at the source to have reached the ring. */
const SETTLE = ticks(0.6);

/** The span the ring is watched over, once the mark is established. */
const WINDOW = ticks(0.3);

let h: Harness;

afterEach(async () => {
  await h?.dispose();
});

/** How many frames of the window the ground around a standing `type` changed on. */
async function ringMotion(type: ComponentType): Promise<number> {
  await standComponent(h, type, 1, ANCHOR.col, ANCHOR.row);
  await h.advance(SETTLE);
  return motion(h, POINTS, WINDOW);
}

it("stops marking an aura source once its produced system is withheld", async () => {
  // Everything the run produced, in hand. The Regulator is stood first in both
  // arrangements, so the two readings of it are taken over the same span of the
  // game's own clock and the only thing that differs between them is the file.
  h = await createHarness();
  await openYard(h, { wave: 1 });
  const marked = await ringMotion("regulator");
  // A Capacitor on the same anchor carries no aura at all, so what its ring does is
  // what this patch of yard does on its own.
  await emptyYard(h);
  const ambient = await ringMotion("capacitor");
  await h.dispose();

  // The same yard, with that one system kept out of the page and every other
  // produced file arriving exactly as it did above.
  h = await createHarness({ withhold: [AURA_SYSTEM] });
  await openYard(h, { wave: 1 });
  const withheld = await ringMotion("regulator");
  await captureStill(h, "withheld");

  assertLessThanOrEqual(
    withheld,
    ambient,
    `the ground around a standing Regulator to change on no more frames than the ` +
      `ground around a Capacitor standing at the same anchor once ` +
      `assets/${AURA_SYSTEM} is withheld, so the pulse marking its aura is the ` +
      `produced system rather than a shape the build draws in code ` +
      `(specs/assets.md); with that system in hand the same ring changed on ` +
      `${marked} of ${WINDOW} frames`,
  );
});
