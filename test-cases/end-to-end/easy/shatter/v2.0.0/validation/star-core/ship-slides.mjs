// Automated validation for the Star-core item `ship-slides`: the star's core is solid
// but not lethal — flying into it costs no life; the ship slides along the surface
// rather than through it. With invulnerability cleared (so a lethal hit WOULD register)
// and the field emptied, the ship is driven straight into the core; the real collision
// code must keep it out of the core, cost no life, and keep the game playing.

import { newGame, poseShip, distToStar, CORE_R, SHIP_R, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("star-core.ship-slides");

  await newGame(api);
  await api.call("setInvuln", 0); // collisions are live: the core is proven non-lethal on its own
  await poseShip(api, { x: 640, y: 420, vx: 0, vy: -300, angle: -Math.PI / 2 });

  const surface = CORE_R + SHIP_R; // 44 — the ship rides the core surface, never inside
  let minD = distToStar((await api.snapshot()).ship);
  for (let i = 0; i < 30; i += 1) {
    await api.step(0.02);
    minD = Math.min(minD, distToStar((await api.snapshot()).ship));
  }
  const snap = await api.snapshot();

  check.expectGe("the ship never penetrates the core (stays at/beyond the surface)", minD, surface - 1);
  check.expectClose("the ship comes to rest sliding on the core surface", distToStar(snap.ship), surface, 1.5);
  check.expectEq("flying into the core costs no life", snap.lives, 3);
  check.expectEq("the game keeps playing (the core is not lethal)", snap.screen, "playing");

  await poseShip(api, { x: 640, y: 460, vx: 0, vy: -320, angle: -Math.PI / 2 });
  await liveClip(api, 800);
  return check.verdict();
}
