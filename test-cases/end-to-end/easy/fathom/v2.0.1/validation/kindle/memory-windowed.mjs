// kindle.memory-windowed: ground outside the vision circle is only hidden, not
// forgotten — the fog memory still holds it, and returning draws it again.
//
// Which tile lies beyond the circle is only known after the sonar flood has run, so the
// pulse, the choice of tile, the two samples and the return trip are all `act`. The
// return uses `setForager`, a control op — `reset` in act would freeze the recording.
import {
  findStraightRun,
  isOpen,
  luminance,
  openTiles,
  parkForager,
  quietBoard,
  sampleColor,
  startPlaying,
  stepTile,
  tileCenter,
} from "../_helpers.mjs";
import { isFogBlack, sampleFog } from "./_kindle.mjs";

export default function item() {
  let beyond;
  let visibility;
  let colBefore;
  let colAfter;
  let fog;

  return {
    id: "kindle.memory-windowed",

    async arrange(api) {
      const snap = await startPlaying(api);
      // Stand on a long straight corridor and clear the board so the forager cannot eat
      // (the vision circle stays at rest) and a single pulse reveals tiles straight down
      // the corridor well past the vision circle.
      const run = findStraightRun(snap, 9);
      // Parked, not merely placed: every distance below is measured from the forager,
      // so a build whose forager swims off on its own would move the frame of reference
      // mid-measurement as well as eating the last pellet.
      await quietBoard(api, { tx: run.tx, ty: run.ty });
      await api.call("clearCooldowns");
    },

    async act(api) {
      await api.call("press", "Space");
      await api.advance(120); // 120 ticks = the old 1.0 s: reveal corridors past the vision circle
      const s = await api.snapshot();
      const R = s.windowRadius;
      const f = s.forager;
      const dist = (c, r) => {
        const p = tileCenter(s.grid, c, r);
        return Math.hypot(p.x - f.x, p.y - f.y);
      };
      // A revealed tile beyond the circle that has an open neighbor to stand on.
      beyond = null;
      let place = null;
      for (const [c, r] of openTiles(s)) {
        if (s.visibility[r][c] === "u") continue;
        const d = dist(c, r);
        if (d <= R * 1.2 || d >= 300) continue;
        for (const dir of ["up", "down", "left", "right"]) {
          const [nc, nr] = stepTile(s, c, r, dir);
          if (isOpen(s.tiles, nc, nr)) {
            beyond = { c, r };
            place = { tx: nc, ty: nr };
            break;
          }
        }
        if (beyond) break;
      }
      if (!beyond) return;
      visibility = s.visibility[beyond.r][beyond.c];
      // A REAL pause (the old wait(120)) so the hidden ground has been painted.
      await api.settle(120);
      const p = tileCenter(s.grid, beyond.c, beyond.r);
      colBefore = await sampleColor(api, p.x, p.y);
      // The build's own flat fog. Without this the item only tested the REMEMBERED
      // half: a build with no vision circle at all draws this tile dim now and lit
      // once the forager returns, which satisfies "returning redraws it" while never
      // having hidden anything. Requiring the tile to read as fog while it is outside
      // the circle is the WINDOWED half the point is named for.
      fog = await sampleFog(api, s, [s.forager, p]);

      await parkForager(api, place); // return near it, and stay there
      await api.advance(6); // 6 ticks = the old 0.05 s
      await api.settle(120); // and again, so the redrawn ground has been painted
      colAfter = await sampleColor(api, p.x, p.y);
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectOk(
        "found a revealed tile beyond the circle",
        Boolean(beyond),
      );
      if (!beyond) return;
      check.expectNe(
        "it is still remembered underneath (not forgotten)",
        visibility,
        "u",
      );
      check.expectOk(
        "while outside the circle it is hidden — painted back to the flat fog",
        isFogBlack(colBefore, fog),
      );
      check.expectGt(
        "returning redraws the remembered ground",
        luminance(colAfter),
        luminance(colBefore) + 8,
      );
    },
  };
}
