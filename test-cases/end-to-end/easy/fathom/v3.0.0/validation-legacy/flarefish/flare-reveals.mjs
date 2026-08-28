// flarefish.flare-reveals: the flare reveals a radial disc of tiles (floor and wall)
// to the player, through walls.
//
// The Flarefish is posed out in the dark instantly (`arrange`); the bloom is the behavior
// under test, so it is `act` and is what the clip shows.
//
// WHAT IS ASKED, AND WHY IT IS NOT "MORE TILES THAN BEFORE". The spec is unusually exact
// here — "Every tile within the flare's radius, floor and wall alike, straight through
// walls, is revealed to you", filling "the full `192 px` radius"
// (`specs/predators/flarefish.md`) — so the disc itself is checkable, and a count that
// merely went up is a much weaker claim than the one the spec makes. A build whose bloom
// lit one extra tile used to pass this on a `+1`.
//
// AND THE READING IS TAKEN A BEAT INTO THE BLOOM, not on the tick the `flaring` flag
// flips. Nothing fixes those to the same tick: one build lights the disc as it raises the
// flag, another raises the flag and lights the disc on the next step, and both are a
// flare that reveals its area. Reading on the flag tick failed the second kind with an
// empty disc — `0` tiles revealed while `flareRadius` already read `192`.
import {
  boardDisturbance,
  denAllExcept,
  poseApart,
  pred,
  quietBoard,
  startPlaying,
  tileCenter,
  ticksFor,
} from "../_helpers.mjs";

// The flare's reach, in px (`specs/predators/flarefish.md`).
const FLARE_RADIUS = 192;

// How far inside the rim a tile must sit to be judged, in px. Half a tile: a tile whose
// center lands within a whisker of `192 px` is one a build may honestly place either side
// of the line, and this item is about the disc being lit, not about where its edge falls.
const RIM_INSET = 16;

// How long into the bloom to read it. A bloom lasts about a second, so a fifth of that is
// well inside it and leaves the rest of the burn for the clip.
const INTO_BLOOM = ticksFor(0.2);

/**
 * Tiles whose centers lie within `radius` px of (x, y), and how many of them the player
 * can see — REVEALED, meaning anything but fog.
 *
 * Not "lit". `visibility` distinguishes `'l'` lit from `'r'` remembered
 * (`specs/instrumentation.md`) without saying whose light `'l'` counts, and builds split
 * on it: one reports a flare-lit disc as lit, another as remembered, and both draw the
 * same revealed disc the spec asks for. What this item is named for is the REVEAL.
 */
function discCoverage(s, x, y, radius) {
  let inside = 0;
  let revealed = 0;
  for (let r = 0; r < s.grid.rows; r++) {
    for (let c = 0; c < s.grid.cols; c++) {
      const p = tileCenter(s.grid, c, r);
      if (Math.hypot(p.x - x, p.y - y) > radius) continue;
      inside += 1;
      if (s.visibility[r][c] !== "u") revealed += 1;
    }
  }
  return { inside, revealed };
}

export default function item() {
  let far;
  let r;
  let quiet;
  let held = true;
  let pre;
  let disc;

  return {
    id: "flarefish.flare-reveals",

    async arrange(api) {
      await startPlaying(api);
      // A posed board: the forager's corridor and, across solid rock, a sealed ring
      // for the Flarefish to patrol — so "far away" holds for the whole watch.
      far = (await poseApart(api, 9)).far; // in an unrevealed region far from the light
      quiet = await denAllExcept(api, ["flarefish"]);
      await api.call("setPredator", "flarefish", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await quietBoard(api);
    },

    async act(api) {
      // The control, taken before any flare: the trench out here is dark, so a disc that
      // is revealed afterwards was revealed BY the flare and not by something that had
      // already lit it. Without this, "every tile inside the radius is revealed" would be
      // satisfied by a board that was never dark to begin with.
      {
        const s0 = await api.snapshot();
        const f0 = pred(s0, "flarefish");
        pre = discCoverage(s0, f0.x, f0.y, FLARE_RADIUS - RIM_INSET);
      }
      // Skipped, not filmed: flares come about every 7 s and a clip has eight, so waiting
      // for one in real time spent the whole recording before the bloom arrived — which is
      // why the clip used to stop just as the flare began.
      r = await api.skipUntil((s) => pred(s, "flarefish").flaring === true, {
        max: ticksFor(12),
        poll: 6,
      });
      if (!r.hit) {
        // No flare inside the window. Before reporting that against the Flarefish, ask
        // whether the scenario was still standing: it patrols a ring sealed off from the
        // forager, so a build whose hunters cross rock reaches the forager, takes a life,
        // and re-dens every predator — after which "it never flared" is true and is about
        // something else entirely.
        held = !boardDisturbance(await api.snapshot(), quiet);
        return;
      }
      // Filmed: the bloom itself, read a beat in so the reveal it applies has landed
      // whichever tick a build applies it on.
      await api.advance(INTO_BLOOM);
      const s = await api.snapshot();
      const fx = pred(s, "flarefish");
      disc = discCoverage(s, fx.x, fx.y, FLARE_RADIUS - RIM_INSET);
      await api.advance(ticksFor(0.8)); // the rest of the burn, for the clip
    },

    async assert(api, check) {
      check.expectOk(
        "the scenario held — the Flarefish stayed in its sealed ring and the forager was not caught",
        held,
      );
      if (!held) return;
      check.expectOk("the Flarefish flares", r.hit);
      if (!r.hit) return;
      check.expectGt(
        "the flare covers a disc of the trench around the Flarefish",
        disc.inside,
        0,
      );
      check.expectLt(
        `the trench around it was dark before the flare (${pre.revealed} of ${pre.inside} revealed)`,
        pre.revealed,
        pre.inside / 2,
      );
      check.expectEq(
        `and every tile inside the flare's radius is revealed by it (${disc.revealed} of ${disc.inside})`,
        disc.revealed,
        disc.inside,
      );
    },
  };
}
