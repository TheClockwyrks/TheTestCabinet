// Automated validation for the Spin sub-item `moving-solo-ai`: the AI opponent's
// paddle (right, in Solo), moving as it strikes, imparts spin just as a human paddle
// does.
//
// The real AI is handed control of its paddle (setAiControl) and a ball is aimed to
// arrive while the AI is still sweeping down the field to intercept it, so the AI
// strikes while its paddle is moving. The real bounce imparts spin from that motion
// (physics.md: `spin += paddleVy * 0.85`) — nothing poses the AI's velocity; its own
// chase is what curves the ball. See validation/_helpers.mjs.
//
// That the AI is still travelling when the ball arrives is the one thing this point
// cannot arrange, only hope for: the AI's speed belongs to the build, and one quick
// enough to close the arranged gap early waits on the lane and strikes at a standstill.
// Then there is no motion to read spin from, and the point says nothing — so it stops
// as an unmet precondition (`requireMovingPaddle`) rather than failing a spin mechanic
// it never got to watch. The speed that caused it is graded on its own two points.

import {
  arrangeAiMovingHit,
  actPaddleHit,
  actCurveOffset,
  assertCurved,
  requireMovingPaddle,
} from "../_helpers.mjs";

export default function item() {
  let hit;
  let curve;

  return {
    id: "spin.moving-solo-ai",

    async arrange(api) {
      await arrangeAiMovingHit(api);
    },

    async act(api) {
      hit = await actPaddleHit(api, "right");
      // Before anything is measured: did the AI actually strike on the move? If it
      // was parked this drive stops here, inconclusive rather than failed — and it
      // stops BEFORE the readings below, which a standstill contact would otherwise
      // satisfy vacuously (no motion, so no spin, so no curve, so every reading
      // agrees with every other and the point passes having watched nothing).
      requireMovingPaddle(hit, { who: "the AI paddle" });
      // Measure the bend over free flight, then hold the rest of the old 96-tick
      // tail for the clip.
      curve = await actCurveOffset(api, 72); // 0.6 s of measured curve
      await api.advance(24);
    },

    async assert(api, check) {
      check.expectOk("the moving AI paddle contacts the ball", hit.hit);
      // The spin imparted must TRACK the AI paddle's own motion (physics.md:
      // `spin += paddleVy * 0.85`), not clear a fixed magnitude. How fast the AI is
      // travelling when it connects is its own chase's business — it moves at its own
      // speed, up to the 560 px/s cap that keeps it slower than the human's 720, and
      // it stops dead inside the deadzone it targets through. A fixed floor tuned to a
      // hard human swing (spin > 400 needs vy > ~470) would reject a conformant,
      // slower AI that applies the spin mechanic perfectly. Reading spin against the
      // paddle's actual vy is robust to whatever speed this contact happened at while
      // still catching a build that imparts no (or wrong) spin.
      const expectedSpin = hit.paddle.vy * 0.85;
      check.expectClose(
        "its motion imparts spin tracking the paddle's speed (spin ≈ vy × 0.85)",
        hit.ball.spin,
        expectedSpin,
        // A fraction of the spin required, with an absolute floor for a gentle
        // contact. Taken on the MAGNITUDE: an AI that comes at the lane from below is
        // just as conformant, and a negative expectation would otherwise collapse the
        // fraction and leave only the floor.
        Math.max(50, Math.abs(expectedSpin) * 0.25),
      );
      // And the spin it imparted must show up in the flight. How hard this shot curves
      // is whatever its own chase earned, so `assertCurved` grades the bend against the
      // spin THIS contact produced, not against a figure taken from a hard human swing.
      assertCurved(check, curve, { who: "the shot off the moving AI paddle" });
    },
  };
}
