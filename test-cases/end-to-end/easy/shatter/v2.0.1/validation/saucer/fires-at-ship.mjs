// Automated validation for the Saucer item `fires-at-ship`: the saucer fires bullets
// aimed at the ship. A saucer is posed on the left, well clear of the star, crossing toward
// a ship posed far to its right; as the real sim runs past the saucer's fire interval it must
// emit an enemy bullet travelling toward the ship.
//
// Posing the ship and spawning the saucer are instant (`arrange`); waiting out the saucer's
// fire interval is the behavior (`act`), so the clip is the shot being taken and crossing to
// the ship.
//
// The saucer is posed once and then LEFT ALONE. The old drive re-pinned it to a fixed spot on
// every sample, which held it motionless for the whole recording — a clip of a parked saucer,
// of the one body on the field whose movement is half the item — and suppressed the weaving
// and star-avoidance the build is supposed to be doing while it lines the shot up. Posing it
// crossing rightward at its own speed keeps it on the ship's left, which is what makes the
// shot's direction meaningful, without freezing it.
//
// What the shot is checked against is its BEARING to the ship at the moment it left, rather
// than a fixed sign on `vx`. "Rightward" is only the direction of the ship while the saucer
// happens to be to its left, and a saucer under its own power need not stay there.
// `specs/hazards.md` also puts up to ±10 degrees of aim error on the shot and adds the
// saucer's own velocity (up to 140 px/s) to a 300 px/s bullet, which can lean it another ~25
// degrees; the closing-speed floor below admits every combination of those and still rejects a
// bullet that was not sent at the ship at all.

import { newGame, poseShip, hyp, TICK, ticks } from "../_helpers.mjs";

const SHIP = { x: 900, y: 520 };
const SAUCER = { x: 250, y: 520 };
const CROSS = 140; // px/s, the saucer's own crossing speed (specs/hazards.md)

export default function item() {
  // The moment the first enemy bullet appeared, read by `assert`.
  let fired;

  return {
    id: "saucer.fires-at-ship",

    // Pose the ship to the saucer's right, within half a field so the shortest
    // wrapped path from the saucer to the ship runs rightward (no wrap seam between
    // them), and both well below the star so neither meets its core.
    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: SHIP.x, y: SHIP.y, vx: 0, vy: 0, angle: 0 });
      await api.call("spawnSaucer");
      await api.call("setSaucer", {
        x: SAUCER.x,
        y: SAUCER.y,
        vx: CROSS,
        vy: 0,
      });
    },

    async act(api) {
      fired = await api.until((s) => s.enemyBullets.length > 0, {
        max: ticks(4), // the fire interval is about 1.6 s (specs/hazards.md)
        poll: TICK,
      });
      await api.advance(90); // 0.75 s tail, so the clip shows the shot cross toward the ship
    },

    async assert(api, check) {
      check.expectOk("the saucer fires an enemy bullet", fired.hit);
      if (!fired.hit) return;

      const shot = fired.snap.enemyBullets[0];
      const from = fired.snap.saucer ?? SAUCER;
      const ship = fired.snap.ship;

      // The shot's speed along the direction the ship actually lay in when it left.
      const dx = ship.x - from.x;
      const dy = ship.y - from.y;
      const len = hyp(dx, dy) || 1;
      const closing = (shot.vx * dx + shot.vy * dy) / len;

      check.expectGt(
        "the shot is aimed at the ship (it closes on it, not away)",
        closing,
        100,
      );
    },
  };
}
