// Automated validation for the Trip sub-item `strobing-red`.
//
// While offline a tripped tower is drawn strobing red (specs/heat.md), so a gapped
// kill-box reads at a glance. The check trips a real emitter, then samples the
// pixels it actually RENDERS on its body — red must dominate both other channels at
// the bright phase of its pulse. Reading the rendered pixel means a build cannot pass
// by a color it does not draw. A Lance is used because its large footprint gives the
// sampler plenty of the tower to read.
//
// The footprint is sampled online and then repeatedly while tripped, and paired through
// `glowBetween`: what a build repaints when a tower trips is what "a tripped tower is
// unmistakable" means, and pairing finds it wherever the build draws it instead of
// betting on a solid body fill. It also makes the null case meaningful — a tower that
// paints identically online and offline has not been made unmistakable at all.
//
// A CLIP, NOT A STILL. The word in the requirement is STROBING, and a strobe is the one
// thing a single frame cannot show: a still of a red tower is equally a still of a tower
// that is permanently red, and it lands on whichever half of the cycle the screenshot
// happened to catch — so the evidence for "unmistakably red" was sometimes the dim half.
// Several seconds of the tripped tower shows the pulse itself, and shows it against the
// same tower online a moment earlier. The channel assertions still decide the verdict;
// the clip is what carries the strobe.
//
// THE GATE IS BUILT, BUT THE LANCE STANDS OFF THE ROUTE IT MAKES.
//
// The trip has to happen for real before there is anything red to sample, and an emitter
// aimed at a lane the build does not use never fires — so the floor is walled top to
// bottom with a two-row gap and every unit files through it (see the note above
// `buildGate` in `_helpers`). But this is a PIXEL check, and the gate's own emitter cell
// sits on the gap rows, which is exactly where the surge walks. A Core crossing the
// footprint between the two samples repaints part of it, `glowBetween` masks to whatever
// moved, and the median it reports is then partly the unit rather than the tower: on one
// build that read a flat grey and failed a tower that was drawn correctly red.
//
// So the Lance is set well below the gap instead of in it. Its 12-tile range is by far
// the longest in the roster and covers the gap comfortably from there, so it still
// engages everything the gate funnels through — while nothing ever walks across the
// pixels being sampled.

import {
  newGame,
  build,
  buildGateWall,
  spawn,
  actUntilTripped,
  actSampleTower,
  actTail,
  glowBetween,
  gateCell,
  GATE_WALLS,
} from "../_helpers.mjs";

// Six rows below the gap: clear of every route across the floor, and about eight tiles
// from the gap's own tiles, well inside the Lance's 12-tile range.
const LANCE_COL = gateCell("lance").col;
const LANCE_ROW = gateCell("lance").row + 6;

// Near the redline; one shot of the Lance's 17.5 self-heat carries it over 100.
const NEAR_TRIP = 92;

// How many times the tripped tower is sampled, and how long the renderer is given
// between samples.
//
// A STROBE IS SAMPLED ACROSS ITS CYCLE, NOT ONCE.
//
// `specs/heat.md` asks for a tripped tower "drawn unmistakably tripped: strobing red",
// and a strobe by definition is not the same color in every frame — it pulses between a
// bright phase and a dim one. A single `getImageData` lands wherever the pulse happens to
// be at that instant, which on one of the builds re-checked here returned a flat dark
// grey about half the time and a strong red the other half, from an implementation that
// draws the strobe exactly as asked. Requiring EVERY frame to be red is a stricter claim
// than the spec makes and it fails builds at random.
//
// So the tower is sampled several times across most of a second and the reddest reading
// is the one asserted on: what has to be true is that the strobe is unmistakably red
// where it is bright, not that it never dims. Six samples 120 ms apart covers roughly
// three quarters of a second, which is several cycles at any pulse rate a person could
// read as a strobe.
const STROBE_SAMPLES = 6;
const STROBE_STEP_MS = 120;

/** How far a color leans red — what "red dominates both other channels" measures. */
function redness(c) {
  return c.r - Math.max(c.g, c.b);
}

export default function item() {
  let id;
  let walls;
  let hit;
  let strobe = null;

  return {
    id: "trip.strobing-red",

    // The trip is a beat in; the rest is the strobe itself, which needs long enough to
    // read as a pulse rather than as a color.
    clipMs: 10000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      walls = await buildGateWall(api);
      id = await build(api, "lance", LANCE_COL, LANCE_ROW);
      await api.call("setHeat", id, NEAR_TRIP);
      await spawn(api, "core", "left");
    },

    // Read the tower online, trip it for real, then read it again while offline. The
    // sample helper settles for a frame first — an instant advance paints nothing, so
    // without that the read would race the renderer. The settle consumes no
    // simulation time in the validate pass, so the online read cannot itself carry
    // the tower over the redline.
    async act(api) {
      const online = await actSampleTower(api, id);

      const r = await actUntilTripped(api, id);
      hit = r.hit;

      // Sample across the strobe cycle and keep the reddest reading — see
      // STROBE_SAMPLES above for why a single frame cannot decide this.
      for (let i = 0; i < STROBE_SAMPLES; i += 1) {
        const tripped = await actSampleTower(api, id, {
          settleMs: i === 0 ? 300 : STROBE_STEP_MS,
        });
        const paired = glowBetween(online, tripped);
        if (
          paired &&
          (strobe === null || redness(paired.after) > redness(strobe.after))
        ) {
          strobe = paired;
        }
      }

      // The strobe is a cycle, so the clip has to hold on it for several of them.
      await actTail(api, 240); // 4 s of the tripped tower pulsing
    },

    async assert(api, check) {
      // A hole in the gate lets the Core walk round the Lance, and "it never tripped"
      // would then be about the scenery rather than about the tower.
      check.expectEq("the gate wall was built", walls, GATE_WALLS);
      check.expectOk("the emitter tripped", hit);
      // Hard: a null result means the footprint paints the same online and tripped,
      // and the channel assertions below would read off null.
      check.assertOk(
        "a tripped tower repaints, rather than looking as it did online",
        strobe !== null,
      );
      check.expectGt(
        "a tripped tower's red channel dominates green",
        strobe.after.r,
        strobe.after.g + 30,
      );
      check.expectGt(
        "a tripped tower's red channel dominates blue",
        strobe.after.r,
        strobe.after.b + 30,
      );
    },
  };
}
