// kindle.flare-second-circle: a Flarefish flare acts as a full-vision second circle,
// drawing the maze inside its bloom even beyond the forager's vision circle.
//
// The tile that has to be sampled is only known once the flare fires (it is chosen
// relative to where the Flarefish has wandered to), so the wait for the bloom and the
// sampling that follows are both `act`.
import {
  denAllExcept,
  findFarTile,
  luminance,
  openTiles,
  pred,
  quietBoard,
  sampleColor,
  startPlaying,
  tileCenter,
} from "../_helpers.mjs";
import { isFogBlack } from "./_kindle.mjs";

const man = (a, b, c, d) => Math.abs(a - c) + Math.abs(b - d);

export default function item() {
  let r;
  let distF;
  let windowRadius;
  let near;
  let col;
  let fogCol;
  let afterFadeCol;

  return {
    id: "kindle.flare-second-circle",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["flarefish"]);
      const far = findFarTile(snap, snap.forager, 11); // beyond the vision circle, and stays far
      await api.call("setPredator", "flarefish", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await quietBoard(api);
    },

    async act(api) {
      // 1140 ticks = the old 9.5 s cap; poll 12 = the old 0.1 s chunk.
      r = await api.until((s) => pred(s, "flarefish").flaring === true, {
        max: 1140,
        poll: 12,
      });
      const s = r.snap;
      const fx = pred(s, "flarefish");
      distF = Math.hypot(fx.x - s.forager.x, fx.y - s.forager.y);
      windowRadius = s.windowRadius;

      // A tile within the flare bloom (close to the Flarefish) but beyond the vision circle.
      near = null;
      for (const [c, r2] of openTiles(s)) {
        if (man(c, r2, fx.tx, fx.ty) < 1 || man(c, r2, fx.tx, fx.ty) > 3)
          continue;
        const p = tileCenter(s.grid, c, r2);
        if (
          Math.hypot(p.x - s.forager.x, p.y - s.forager.y) >
          s.windowRadius + 16
        ) {
          near = { c, r: r2, p };
          break;
        }
      }
      if (!near) return;
      // A REAL pause (the old wait(150)) so the bloom has been painted before sampling.
      await api.settle(150);
      col = await sampleColor(api, near.p.x, near.p.y);

      // Then let the bloom go out and read the SAME tile again. "When the flare fades,
      // its circle disappears entirely ... everything the flare had lit that lies
      // outside your own vision circle goes pitch black again" (specs/gameplay.md), so
      // this tile must return to fog. It is what makes the point a check of the flare
      // rather than of brightness: a build that simply draws the whole maze also lights
      // this tile during the bloom, and only the fade separates the two.
      await api.until((sn) => pred(sn, "flarefish").flaring === false, {
        max: 300,
        poll: 12,
      });
      await api.advance(90); // 90 ticks = 0.75 s, comfortably past the fade
      await api.settle(150);
      afterFadeCol = await sampleColor(api, near.p.x, near.p.y);
      // A far fog tile for reference.
      const fog = openTiles(s).find(
        ([c, r2]) =>
          s.visibility[r2][c] === "u" && man(c, r2, fx.tx, fx.ty) > 8,
      );
      fogCol = fog
        ? await sampleColor(
            api,
            tileCenter(s.grid, fog[0], fog[1]).x,
            tileCenter(s.grid, fog[0], fog[1]).y,
          )
        : { r: 3, g: 6, b: 12 };
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectOk("the Flarefish flares", r.hit);
      check.expectGt(
        "the Flarefish is beyond the forager's vision circle",
        distF,
        windowRadius,
      );
      check.expectOk(
        "found a bloom tile beyond the vision circle",
        Boolean(near),
      );
      if (!near) return;
      check.expectGt(
        "the flare draws the maze beyond the vision circle",
        luminance(col),
        luminance(fogCol) + 6,
      );
      check.expectOk(
        "and it is the flare doing it — once the bloom fades the tile goes black again",
        isFogBlack(afterFadeCol, fogCol),
      );
    },
  };
}
