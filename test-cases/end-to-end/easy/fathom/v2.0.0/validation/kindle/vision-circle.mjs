// kindle.vision-circle: terrain is drawn only inside the vision circle; explored ground
// beyond it is pitch black. A sonar pulse reveals corridors out past the circle, so a
// revealed tile inside the circle is drawn while a revealed tile beyond it is black.
//
// Which tiles are revealed is only known after the flood has run, so the pulse, the
// choice of the two tiles and the sampling are all `act`.
import {
  startPlaying,
  findStraightRun,
  openTiles,
  tileCenter,
  sampleColor,
  luminance,
  isDark,
} from "../_helpers.mjs";

export default function item() {
  let inside;
  let beyond;
  let ci;
  let cb;

  return {
    id: "kindle.vision-circle",

    async arrange(api) {
      const snap = await startPlaying(api);
      // Stand on a long straight corridor and clear the board first: the forager cannot
      // eat (so brightness — and the vision circle — stay at rest), and a single pulse
      // reveals tiles straight down the corridor well past the vision circle.
      const run = findStraightRun(snap, 9);
      await api.call("setForager", { tx: run.tx, ty: run.ty, dir: run.dir });
      await api.call("poseLastPlankton");
      await api.call("clearCooldowns");
    },

    async act(api) {
      await api.call("press", "Space");
      await api.advance(120); // 120 ticks = the old 1.0 s: flood the corridor well past the vision circle
      const s = await api.snapshot();
      const R = s.windowRadius;
      const f = s.forager;
      const dist = (c, r) => {
        const p = tileCenter(s.grid, c, r);
        return Math.hypot(p.x - f.x, p.y - f.y);
      };
      inside = null;
      beyond = null;
      for (const [c, r] of openTiles(s)) {
        if (s.visibility[r][c] === "u") continue;
        const d = dist(c, r);
        if (!inside && d > 25 && d < R * 0.55) inside = { c, r };
        if (!beyond && d > R * 1.2 && d < 300) beyond = { c, r };
      }
      if (!inside || !beyond) return;
      // A REAL pause (the old wait(120)) so the flooded trench has been painted.
      await api.settle(120);
      const pi = tileCenter(s.grid, inside.c, inside.r);
      const pb = tileCenter(s.grid, beyond.c, beyond.r);
      ci = await sampleColor(api, pi.x, pi.y);
      cb = await sampleColor(api, pb.x, pb.y);
      await api.screenshot("circle");
    },

    async assert(api, check) {
      check.expectOk(
        "found revealed tiles inside and beyond the circle",
        Boolean(inside && beyond),
      );
      if (!inside || !beyond) return;
      check.expectOk(
        "explored ground beyond the vision circle is pitch black",
        isDark(cb),
      );
      check.expectGt(
        "terrain inside the vision circle is drawn",
        luminance(ci),
        luminance(cb) + 8,
      );
    },
  };
}
