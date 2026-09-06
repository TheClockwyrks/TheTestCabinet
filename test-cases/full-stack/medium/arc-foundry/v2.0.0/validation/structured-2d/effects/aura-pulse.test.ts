// Arc Foundry — effects/aura-pulse: a structure carrying an aura is marked by one.
//
// THE REQUIREMENT, from `specs/assets.md`: the aura pulse is spawned while "a
// structure carrying an aura stands on the yard", it carries "a slow pulse ring at
// the source, marking the aura it projects", and it is spawned "at the position of
// the event that raised it: ... the aura pulse at its source". `specs/components.md`
// gives the aura to the Regulator, which "never fires: it has no range, no damage,
// no firing head, no projectile, and no targeting priority, and its aura is its
// whole reach".
//
// THE PRODUCED FILES REACH THE LOADER THROUGH THE HARNESS, which stands the
// committed `assets/` tree up for every check it builds: the system so it can be
// played, and the sprites so the mount under the control reading is the one the
// build produced.
//
// THE READING IS A COMPARISON, BECAUSE THE PULSE IS NOT AN EVENT. Every other
// effect has a frame it is raised on and a frame before it; this one is played the
// whole time the source stands. So the same anchor is stood on twice, once by a
// Regulator and once by a Capacitor of the same tier, and the ground around it read
// both times. A Capacitor carries no aura (`specs/components.md` gives the aura to
// the Regulator alone), so what the two readings differ by is the mark on the aura
// source.
//
// WHAT IS READ, AND WHY IT IS OUTSIDE THE FOOTPRINT. `specs/assets.md` also gives
// the Regulator a cycle at `components/regulator/fire/`, "the Regulator's slow aura
// pulse, played as a loop rather than on a shot" — which is drawn on the mount, a
// `40 x 40` sprite on a `2` by `2` footprint. Reading inside the footprint would
// therefore read that cycle rather than the pulse the aura projects, and pass a
// build that animated the mount and marked nothing. The ring sampled starts outside
// the footprint and stays well inside the `90` units of aura radius a Scrap
// Regulator projects.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  emptyYard,
  type Harness,
  openYard,
  standComponent,
} from "../harness";
import { annulus, motion } from "./region";
import { structureCenter } from "../constants";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 24, row: 17 };

/** Outside the `2` by `2` footprint, inside the Scrap aura radius of `90`. */
const POINTS = annulus(structureCenter(ANCHOR.col, ANCHOR.row), 26, 60, 4);

/**
 * The rate this check is driven at.
 *
 * EVERY FRAME A PIXEL READING IS TAKEN OVER IS A FRAME THE HOST HAS TO RASTERIZE,
 * so the frames a span is cut into are what such a check costs. The specification
 * fixes no frame size and guarantees that "an interval of simulation time reaches
 * the same state however it was divided into frames and whatever frame rate
 * produced it" (specs/instrumentation.md), so each span below is the span it
 * always was and only the number of frames it is divided into is this check's.
 */
const AURA_HZ = 60;

/** One window, in seconds of simulation. */
const WINDOW_SECONDS = 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: AURA_HZ });
});

afterEach(() => {
  h?.dispose();
});

it("marks the ground around a Regulator and not around a Capacitor", async () => {
  openYard(h, { wave: 1 });

  // The control first: a firing component of the same tier at the same anchor,
  // with nothing in range so it never fires.
  standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  await h.advance(1);
  const window = h.ticks(WINDOW_SECONDS);
  const unmarked = await motion(h, POINTS, window);

  emptyYard(h);
  const marked = await captureReplay(h, "aura", async () => {
    standComponent(h, "regulator", 1, ANCHOR.col, ANCHOR.row);
    await h.advance(1);
    return motion(h, POINTS, window);
  });

  assertGreaterThan(
    marked,
    unmarked,
    "the ground around a standing Regulator to change on more frames than the " +
      "ground around a Capacitor standing at the same anchor, so the aura it " +
      `projects is marked (specs/assets.md); the Capacitor's changed on ` +
      `${unmarked} of ${window} frames`,
  );
});
