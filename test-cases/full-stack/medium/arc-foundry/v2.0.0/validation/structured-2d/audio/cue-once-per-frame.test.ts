// Arc Foundry — audio/cue-once-per-frame: a frame that raises one event several
// times plays its cue once.
//
// THE REQUIREMENT, from `specs/ui.md`: "Each cue is played on the frame its event
// happens, by the code that raised it, and at most once on that frame; a frame that
// raises the same event several times plays its cue once."
//
// HOW IT IS COUNTED. The engine announces every play, with the cue's name and the
// frame it sounded on, so the count is exact: the frame three units die on must
// carry the kill cue exactly once. There is nothing to infer and nothing to
// compare against a second drive — a build that plays one cue per unit announces
// three plays on that frame and fails on the number.
//
// THE DRIVE. One Scrap Arc-Node and three Motes posed to one health:
// `specs/components.md` makes the Arc-Node's shot "discharge at its impact point,
// dealing the shot's full damage to every unit ... within the splash radius",
// which is `42` at Scrap, so the two placed twenty-five units either side of the
// primary die on the frame the primary does. A further unit is held at the map's
// entry and out of range so the live wave cannot clear underneath the reading.
//
// WHERE THE LISTENING STARTS. After the shot, because the frame the Arc-Node fires
// carries its own firing cue and this point is about the kill cue's count.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  holdWaveClear,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  watchCues,
  type Harness,
} from "../harness";
import { ANCHOR, TARGET, onFrame } from "./cues";

/** Either side of the primary, inside the Scrap Arc-Node's splash radius of `42`. */
const SPREAD = 25;

/** How many units the one discharge removes on one frame. */
const VICTIMS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the kill cue once on a frame three units die on", async () => {
  openYard(h, { wave: 1 });
  holdWaveClear(h);
  const node = standComponent(h, "arcnode", 1, ANCHOR.col, ANCHOR.row);
  h.debug.setTargeting(node, "nearest");

  const victims = [parkUnit(h, "mote", TARGET, { hp: 1 })];
  for (const offset of [-SPREAD, SPREAD]) {
    victims.push(
      parkUnit(h, "mote", { x: TARGET.x, y: TARGET.y + offset }, { hp: 1 }),
    );
  }
  assertLength(
    victims,
    VICTIMS,
    "three one-health Motes inside a Scrap Arc-Node's splash radius " +
      "(specs/components.md)",
  );

  const discharge = await captureReplay(h, "once", async () => {
    const fired = await h.until((s) => s.projectiles.length > 0, {
      maxFrames: ticks(4),
    });
    const cues = watchCues(h);
    const died = await h.until(
      (s) => !s.units.some((u) => victims.includes(u.id)),
      { maxFrames: ticks(2) },
    );
    return { fired: fired.hit, died: died.hit, frame: h.frame(), cues };
  });

  assertEqual(
    discharge.fired,
    true,
    "a Scrap Arc-Node with units inside its range to fire within four seconds " +
      "(specs/components.md)",
  );
  assertEqual(
    discharge.died,
    true,
    "a Scrap Arc-Node's discharge to remove every one-health Mote inside its " +
      "splash radius (specs/components.md)",
  );
  assertLength(
    onFrame(discharge.cues, discharge.frame).filter(
      (cue) => cue.cue === CUES.kill,
    ),
    1,
    `the ${CUES.kill} cue to sound exactly once on the frame ${VICTIMS} units ` +
      "die, rather than once per unit (specs/ui.md)",
  );
});
