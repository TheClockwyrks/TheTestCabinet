// Automated validation for the Gyre sub-item `obstacles-sway`: the obstacles move —
// each sways vertically about its base center as the obstacle clock advances.
//
// setObstacleClock poses the obstacles at a chosen clock time and holds them there
// (see specs/instrumentation.md), so the check reads each obstacle's center back at
// two clock times: upright at 0, and a quarter of the sway period later where the
// sway is at its peak. Each obstacle's center y must move well off its base, and the
// two must move in opposite directions (they sway in anti-phase, keeping the field
// balanced).

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gyre.obstacles-sway");

  await api.reset();
  await api.call("startMatch", "versus"); // obstacle clock at 0, held while driven
  await api.call("setObstacleClock", 0);
  const at0 = (await api.snapshot()).obstacles;
  await api.call("setObstacleClock", 0.9); // ~quarter of the sway period: peak sway
  const atPeak = (await api.snapshot()).obstacles;

  check.expectClose(
    "obstacle A starts at its base center y",
    at0[0].cy,
    220,
    2,
  );
  check.expectClose(
    "obstacle B starts at its base center y",
    at0[1].cy,
    500,
    2,
  );
  const dA = atPeak[0].cy - at0[0].cy;
  const dB = atPeak[1].cy - at0[1].cy;
  check.expectGt(
    "obstacle A sways vertically as the clock advances (|Δcy|)",
    Math.abs(dA),
    40,
  );
  check.expectGt(
    "obstacle B sways vertically as the clock advances (|Δcy|)",
    Math.abs(dB),
    40,
  );
  check.expectLt(
    "the two obstacles sway in opposite directions (product of their Δcy)",
    dA * dB,
    0,
  );

  // A clip: the obstacles swaying under the live clock. Starting via keys (not a
  // control op) leaves the clock running, so the obstacles actually move.
  await api.reset();
  await api.call("press", "Enter"); // SOLO — a live match, clock advancing
  await api.wait(1800);

  return check.verdict();
}
