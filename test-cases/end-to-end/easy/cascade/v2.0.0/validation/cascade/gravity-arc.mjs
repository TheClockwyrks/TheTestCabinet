// Automated validation for the Victory-cascade sub-item `gravity-arc`.
//
// A launched card pops up (its initial vy is a slight upward −120) then falls under
// gravity: every fixed step, vy += 1800·dt (specs/victory.md). Under the manual
// clock the sim advances by exact fixed steps, so vy is asserted exactly. A short
// live clip then shows the arc.

import { FIXED, GRAVITY, LAUNCH_VY, winBoard } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cascade.gravity-arc");

  await winBoard(api, 7);

  // One fixed step launches the first card and applies one step of gravity.
  await api.step(FIXED);
  let s = await api.snapshot();
  const f1 = s.cascade.flyers[0];
  check.expectClose(
    "vy after one step is the launch pop plus one step of gravity",
    f1.vy,
    LAUNCH_VY + GRAVITY * FIXED,
    1e-6,
  );
  // The card starts at the foundation's top-y (24) and pops UP, so its y dips above
  // its start (a smaller y) while vy is still negative.
  check.expectLt("the card has popped up (y above its launch position)", f1.y, 24);
  const vy1 = f1.vy;

  // Four more steps: vy must increase by exactly four steps of gravity (still in
  // free flight, well before any floor bounce).
  await api.step(4 * FIXED);
  s = await api.snapshot();
  const f5 = s.cascade.flyers[0];
  check.expectClose(
    "vy after five steps follows gravity exactly",
    f5.vy,
    LAUNCH_VY + GRAVITY * 5 * FIXED,
    1e-6,
  );
  check.expectClose(
    "each step adds exactly 1800·dt to vy",
    f5.vy - vy1,
    GRAVITY * 4 * FIXED,
    1e-6,
  );

  // A live clip of the arc.
  await api.call("setAutoStep", true);
  await api.wait(2500);

  return check.verdict();
}
