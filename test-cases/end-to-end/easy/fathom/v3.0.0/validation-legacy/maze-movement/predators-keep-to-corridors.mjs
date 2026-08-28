// maze-movement.predators-keep-to-corridors: a predator travels the corridors, never the
// rock — it rounds an obstacle to reach its fix, and when there is nowhere legal to go it
// goes nowhere.
//
// `specs/predators.md` fixes both halves in the same paragraph. "All predators move on the
// tile grid, along corridor centers", and while holding a fix a predator "pursues, following
// the shortest corridor path to the fixed tile, rounding walls to reach it. It must
// genuinely path around obstacles: it follows the shortest corridor route to the fixed tile
// rather than only ever stepping in the direction that shortens the straight-line distance
// … rounding the corner you slipped behind rather than pressing into the wall between you."
//
// WHY THIS IS ITS OWN ITEM, AND WHY IT IS THE FORAGER'S `no-wall` FOR HUNTERS. Every posed
// fixture in this suite keeps a scenario apart with rock: a bystander walled off from its
// subject, a pair sealed into neighboring cells, a hunter in a sealed ring. All of it rests
// on a predator not crossing rock, and until now nothing checked it. A build whose Gloamfin
// steps into the wall between two sealed cells was caught by `gloamfin/silent-when-close`,
// whose subject is silence — a verdict about the wrong thing, in the one item whose geometry
// happened to expose it. It could as easily have surfaced nowhere. This item owns the claim,
// so the checks that merely stand on it can raise a precondition and step aside.
//
// TWO SHAPES, BECAUSE ONE OF THEM IS NOT ENOUGH. A build can respect walls whenever it has a
// legal move and still walk into rock when it has none: the one that prompted this item
// routes a spine correctly and steps straight into the wall the moment it is boxed in. The
// other order happens too — a hunter that only ever steps toward the straight line rounds
// nothing, which is the failure the spec paragraph above spells out. So the item asks for
// both: route around the obstacle, and stand still when there is nowhere to route to.
//
// The Gloamfin carries it because it hunts by sound and needs no light managed to hold a fix
// (`specs/predators/gloamfin.md`); the rule under test is the shared one every predator obeys.
import {
  startPlaying,
  poseMaze,
  denAllExcept,
  pred,
  ticksFor,
} from "../_helpers.mjs";

// THE OBSTACLE. Two corridors with a rock spine between them, joined at the right-hand end
// only. `P` starts at the far left of the top run and its fix is `F`, directly below it
// through the spine — so the one direction that shortens the straight line is rock, and the
// only way there is right, down, and back along the bottom. Ten tiles, `320 px`, which the
// chase cap crosses in about `2.4 s`.
const SPINE = ["P....", "####.", "F...."];

// AND NOWHERE TO GO. Each of them sealed into its own tile, four apart — well outside the
// Gloamfin's `64 px` hearing, so nothing about the pose depends on what it can hear. A
// conforming predator has no open neighbor and so simply does not move; there is no reading
// of "along corridor centers" that lets it into the rock around it.
//
// `specs/instrumentation.md` makes this a layout a build must cope with: a fixture "is used
// exactly as given and is NOT required to satisfy the rules of `specs/maze.md`", and
// "because such a board is legal, the game has to keep running on one".
const BOXED = ["P", "", "", "", "F"];

// How long each half is watched. The route is given half again the `2.4 s` it takes at the
// chase cap, so a slower-but-legal hunter still arrives; the box is watched for a second,
// which is thirty tiles' worth of travel at any predator speed the spec names.
const ROUTE_WATCH = ticksFor(3.6);
const BOX_WATCH = ticksFor(1);

/** The predator's tile, and whether that tile is rock. */
const standing = (snap) => {
  const p = pred(snap, "gloamfin");
  return { p, rock: snap.tiles[p.ty]?.[p.tx] === "#" };
};

export default function item() {
  let boxed;
  let route;

  return {
    id: "maze-movement.predators-keep-to-corridors",

    async arrange(api) {
      await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);

      // THE BOXED HALF RUNS HERE, AND INSTANTLY. `skip` advances the simulation without
      // spending the clip, which is what setup is for: the picture worth keeping is the
      // hunter taking the long way round, not a second of a predator correctly doing
      // nothing. The verdict still covers it — the sweep below is the real sim either way.
      {
        const board = await poseMaze(api, BOXED, { housed: false });
        await api.call("setForager", board.mark("F"));
        await api.call("setPredator", "gloamfin", {
          ...board.mark("P"),
          mode: "chase",
        });
        const home = (await api.snapshot()).predators.find(
          (p) => p.kind === "gloamfin",
        );
        boxed = { start: `${home.tx},${home.ty}`, rock: null, left: null };
        for (let spent = 0; spent < BOX_WATCH; spent += 6) {
          await api.skip(6);
          const { p, rock } = standing(await api.snapshot());
          if (rock && !boxed.rock) boxed.rock = `${p.tx},${p.ty}`;
          if (`${p.tx},${p.ty}` !== boxed.start && !boxed.left) {
            boxed.left = `${p.tx},${p.ty}`;
          }
        }
      }

      // And now the shape the clip is of.
      const board = await poseMaze(api, SPINE, { housed: false });
      await api.call("setForager", board.mark("F"));
      await api.call("setPredator", "gloamfin", {
        ...board.mark("P"),
        mode: "chase",
      });
      route = { target: board.mark("F"), rock: null, rounded: false };
    },

    async act(api) {
      const opening = await api.snapshot();
      for (let spent = 0; spent < ROUTE_WATCH; spent += 6) {
        await api.advance(6);
        const snap = await api.snapshot();
        const { p, rock } = standing(snap);
        if (rock && !route.rock) route.rock = `${p.tx},${p.ty}`;
        // Rounding the spine means reaching the far corridor — the row the fix is on. A
        // hunter that presses into the wall between them never gets there however long it
        // pushes, which is the whole difference the spec draws.
        if (p.ty === route.target.ty) route.rounded = true;
        // Contact ends the watch: it arrived, and everything after this is a dive reset.
        if (snap.lives < opening.lives) {
          route.rounded = true;
          break;
        }
      }
    },

    async assert(api, check) {
      check.expectOk(
        "boxed into a tile with no open neighbor, the predator stays out of the rock" +
          (boxed.rock ? ` — it stood on the wall tile at (${boxed.rock})` : ""),
        boxed.rock === null,
      );
      check.expectEq(
        "and so stays on the tile it was posed on, having nowhere legal to go",
        boxed.left ?? boxed.start,
        boxed.start,
      );
      check.expectOk(
        "chasing a fix through an obstacle, it never travels over rock" +
          (route.rock ? ` — it stood on the wall tile at (${route.rock})` : ""),
        route.rock === null,
      );
      check.expectOk(
        "and it genuinely rounds the obstacle, reaching the corridor its fix is on rather " +
          "than pressing into the wall between them",
        route.rounded,
      );
    },
  };
}
