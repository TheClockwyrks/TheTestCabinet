// Arc Foundry — audio/cue-once-per-frame: a frame that raises one event several
// times plays its cue once.
//
// THE REQUIREMENT, from `specs/ui.md`: "Each cue is played on the update its event
// happens, and at most once on that update; an update that raises the same event
// several times plays its cue once."
//
// HOW A COUNT IS MADE MEANINGFUL WITHOUT A CUE'S NAME. From outside an engineless
// build a sound is a sound: a build is free to make one cue out of a tone and a
// noise burst, so the NUMBER of sounds on a frame says nothing on its own. What
// says something is the SAME frame driven twice, once with one unit dying on it and
// once with three. Whatever a build's kill cue is made of, it costs the same on
// both frames if it is played once — and three times as much on the second if it is
// played per unit. So the two counts are compared to each other rather than to a
// figure.
//
// THE TWO DRIVES ARE THE SAME DRIVE BUT FOR THE NUMBER DYING. The same Scrap
// Arc-Node at the same anchor, the same shot at the same primary target at the same
// distance, and the same frame of impact; `specs/components.md` makes the Arc-Node's
// shot "discharge at its impact point, dealing the shot's full damage to every
// unit ... within the splash radius", which is `42` at Scrap, so the two extra
// units placed twenty-five units either side of the primary die on the frame the
// primary does. Every unit is posed to one health, so all of them die to that one
// discharge. A further unit is held at the map's entry and out of range in both
// drives, so the live wave cannot clear underneath either reading.
//
// WHERE THE LISTENING STARTS. After the shot, because the frame the Arc-Node fires
// carries its own firing cue and the name of a sound is not observable here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  emptyYard,
  holdWaveOpen,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  watchCues,
  type Harness,
} from "../harness";
import { ANCHOR, TARGET, onFrame, firstSound } from "./cues";

/** Either side of the primary, inside the Scrap Arc-Node's splash radius of `42`. */
const SPREAD = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

/** Drive one Arc-Node discharge that removes `count` units on one frame. */
async function discharge(
  count: number,
): Promise<{ fired: boolean; died: boolean; sounds: number }> {
  await emptyYard(h);
  await holdWaveOpen(h);
  const node = await standComponent(h, "arcnode", 1, ANCHOR.col, ANCHOR.row);
  await h.debug.setTargeting(node, "nearest");

  const victims: number[] = [await parkUnit(h, "mote", TARGET, { hp: 1 })];
  for (const offset of [-SPREAD, SPREAD].slice(0, count - 1)) {
    victims.push(
      await parkUnit(
        h,
        "mote",
        { x: TARGET.x, y: TARGET.y + offset },
        { hp: 1 },
      ),
    );
  }

  const fired = await h.until((s) => s.projectiles.length > 0, {
    maxFrames: ticks(4),
  });
  const cues = watchCues(h);
  const died = await h.until(
    (s) => !s.units.some((u) => victims.includes(u.id)),
    { maxFrames: ticks(2) },
  );
  return {
    fired: fired.hit,
    died: died.hit,
    sounds: onFrame(cues, h.frame()).length,
  };
}

it("plays the same on a frame three units die on as on one", async () => {
  await openYard(h, { wave: 1 });
  await firstSound(h);

  const one = await discharge(1);
  const three = await captureReplay(h, "once", () => discharge(3));

  assertEqual(
    one.fired && one.died && three.fired && three.died,
    true,
    "a Scrap Arc-Node to fire and its discharge to remove every one-health " +
      "Mote inside its splash radius, in both drives (specs/components.md)",
  );
  assertGreaterThan(
    one.sounds,
    0,
    "a cue to sound on the frame a unit dies (specs/ui.md)",
  );
  assertEqual(
    three.sounds,
    one.sounds,
    "a frame that removes three units to sound exactly what a frame that " +
      "removes one sounds, so a cue raised several times on one update is " +
      "played once (specs/ui.md)",
  );
});
