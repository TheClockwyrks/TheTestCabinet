// audio/trip-cue — the frame a firing emitter is carried over `100` sounds MORE
// than every frame of the run of shots that got it there.
//
// `specs/audio.md`'s cue table: `trip` answers "An emitter trips", and every cue
// is "raised by the frame that resolves the event it answers". `specs/heat.md`
// fixes that frame: "The trip is a crossing, not a value. An emitter trips on the
// frame in which its newly written heat reaches `100` having opened that frame
// below `100`."
//
// THE TRIP IS REACHED ON THE REAL PATH, WHICH IS THE WHOLE POINT OF THE ITEM.
// `setTowerTripped` "sets that flag alone, touching neither the heat nor
// `tripTimer` and raising no cue" (`specs/instrumentation.md`), and no operation
// of that surface plays a cue at all. So the emitter posed here is an ordinary
// one, cold, online, with its thermal model running, and it heats itself: each
// shot adds `heatPerShot / mass` (`specs/heat.md`) against air cooling
// proportional to its heat, and the Stutter "pours on heat fastest and has the
// lowest mass and the lowest redline" (`specs/towers.md`), so its own gun carries
// it to `100` inside a few seconds of game time. Nothing here predicts WHICH
// frame that is: the drive reads the frame the build actually tripped on.
//
// WHY PRESENCE ALONE CANNOT DECIDE THIS POINT. The heat that crosses `100` is
// added BY a shot, so the trip frame lawfully carries two cues — `fire` for the
// shot and `trip` for the crossing. A cue's NAME is unobservable from outside an
// engineless build (`audio/cues`), so "the trip frame sounded" is equally true of
// a build that plays its fire cue and no trip cue at all.
//
// WHAT DECIDES IT: COUNTING, AGAINST EVERY OTHER SHOT OF THE SAME RUN. One cue is
// one defined sound played the same way each time (`specs/audio.md`), so a frame
// carrying `fire` and `trip` emits strictly more than a frame carrying `fire`
// alone — and this drive produces a dozen of the latter before it produces the
// former, off the same emitter, at the same rate, on the same target. The trip
// frame is held strictly above the LOUDEST of them, which is an ordering rather
// than a threshold: a build whose every cue is a chord passes it exactly as one
// whose cues are single tones does, and no number of sources per cue is assumed.
//
// THE TARGET CANNOT DIE AND CANNOT MOVE. Its hp is `poseTarget`'s default, far
// past what a Stutter removes in a scenario, so no shot of the run carries a
// death cue; its motion is off, so it cannot leave the emitter's range partway
// through and cannot reach an exhaust. `startRun` leaves nothing else on the
// floor and shuts the world gate, so the run of shots and the crossing are the
// only events in the window.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseTarget,
  poseTower,
  requireTower,
  startRun,
  watchCues,
  type Harness,
} from "../harness";
import { FREE_SITE } from "../fixtures";
import {
  TRIP_CEILING,
  frameWhere,
  peakOtherThan,
  reachFirstInput,
  soundsOn,
} from "./cues";

/**
 * Where the target stands: three and a half tiles from the emitter's footprint
 * centre, inside the Stutter's `5.0`-tile range (`specs/towers.md`,
 * `specs/combat.md`), and clear of both vent-to-exhaust corridors.
 */
const TARGET_TILE = { col: 8, row: 5 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds more on the frame it trips than on any shot that got it there", async () => {
  // The build is silent until a player has touched it (specs/audio.md), so
  // the first input is delivered before anything is posed.
  await reachFirstInput(h);
  await startRun(h);
  // An ordinary emitter: cold, online, both faculties running, exactly as
  // `addTower` leaves one (`specs/instrumentation.md`). The heat is the build's
  // own from here on.
  const emitter = await poseTower(h, "stutter", FREE_SITE.col, FREE_SITE.row);
  await poseTarget(h, "mote", TARGET_TILE.col, TARGET_TILE.row);
  await h.armAudio();

  const opened = requireTower(await h.snapshot(), emitter, "the pose");
  const played = watchCues(h);

  const trip = await frameWhere(
    h,
    (snapshot) => requireTower(snapshot, emitter, "the trip").tripped,
    TRIP_CEILING,
    "the trip",
  );
  const tripFrame = trip.frame;
  const heard = [...played];

  await captureStill(h, "trip");

  assertEqual(
    opened.tripped,
    false,
    "the emitter to be online when the drive opened",
  );
  assertEqual(
    opened.heat,
    0,
    "the heat the emitter was posed at, before a shot of its own",
  );
  assertEqual(
    trip.hit,
    true,
    "the firing emitter to carry its own heat over 100 and trip",
  );
  assertGreaterThan(
    requireTower(trip.snapshot, emitter, "the trip").heat,
    opened.heat,
    "the heat the emitter's own shots left it at",
  );

  const shotSounds = peakOtherThan(heard, tripFrame);
  assertGreaterThan(
    shotSounds,
    0,
    "sounds emitted on the frames of the shots that heated the emitter",
  );
  assertGreaterThan(
    soundsOn(heard, tripFrame),
    shotSounds,
    `the sound on frame ${tripFrame}, which carries the trip cue on top of ` +
      `the shot that crossed 100 (the loudest plain shot emitted ${shotSounds})`,
  );
});
