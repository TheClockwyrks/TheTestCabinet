// Automated validation for the Victory-cascade sub-item `floor-bounce`.
//
// When a falling card's bottom edge reaches the floor while moving down, it bounces:
// vy is reflected and damped to 0.80× and the card is reseated on the floor, while vx
// is unchanged (no floor friction) — specs/victory.md. Under the manual clock the sim
// advances by exact fixed steps, so the first flyer is stepped one step at a time
// until its vy flips from downward (>0) to upward (<0) — the bounce — and the exact
// relation is asserted. A short live clip then shows the bouncing.

import { BOUNCE_DAMP, FIXED, FLOOR_Y, GRAVITY, winBoard } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cascade.floor-bounce");

  await winBoard(api, 3);
  await api.step(FIXED); // launch the first card

  let prev = (await api.snapshot()).cascade.flyers[0];
  let bounced = false;
  for (let i = 0; i < 400 && !bounced; i += 1) {
    await api.step(FIXED);
    const cur = (await api.snapshot()).cascade.flyers[0];
    // A floor bounce is the step where downward motion (vy > 0) becomes upward
    // (vy < 0). Gravity is applied first this step, so the pre-bounce vertical speed
    // is prev.vy + 1800·dt.
    if (prev.vy > 0 && cur.vy < 0) {
      const preBounceVy = prev.vy + GRAVITY * FIXED;
      check.expectClose(
        "the bounce reflects and damps vy to 0.80× (upward)",
        cur.vy,
        -preBounceVy * BOUNCE_DAMP,
        1e-3,
      );
      check.expectClose("the horizontal velocity is unchanged (no floor friction)", cur.vx, prev.vx, 1e-6);
      check.expectClose("the card is reseated on the floor", cur.y, FLOOR_Y, 1e-6);
      bounced = true;
    }
    prev = cur;
  }

  check.expectOk("the first card bounced off the floor", bounced);

  // A live clip of the bouncing cards.
  await api.call("setAutoStep", true);
  await api.wait(2500);

  return check.verdict();
}
