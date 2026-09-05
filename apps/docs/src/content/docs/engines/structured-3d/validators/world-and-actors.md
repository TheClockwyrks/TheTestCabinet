---
title: The World and Its Actors
---

The framework the engine owns is what a check reads. The level that is open, the
match phase, the actors in the world, where each one stands and faces, which
controller holds which pawn, and what a transition produced are all engine
state, reachable from `engine.world` and `engine.instance` without the build
exporting anything of its own.

## The level and the match phase

`world.level` is the name the world was opened under, and `world.state.phase` is
the match phase. `setPhase` writes the phase onto the game state, so the two
always agree and a check reads either one.

```ts
import { LEVELS } from "../../src/constants";
import { createHarness } from "../harness";

it("the title level waits before a match starts", async () => {
  const { engine } = createHarness();
  await engine.initialize();
  const world = engine.world;

  expect(world.level).toBe(LEVELS.title);
  expect(world.state.phase).toBe("waiting");

  engine.debug.startMatch("versus");
  await engine.advance(1);

  expect(world.state.phase).toBe("playing");
});
```

`setPhase` also emits `match:phase` carrying the new phase and the previous one,
and setting the phase the mode already holds emits nothing. A check that is
about the moment the phase changed subscribes to that event; a check that is
about where the match ended up reads `world.state.phase`.

## Finding actors

`world.byTag(tag)` returns the live actors carrying a tag, `world.ofType(type)`
the live actors that are instances of a class, and `world.find(type)` the first
entry `ofType` would return, or `null`. All three answer in spawn order, as a
copy the caller owns.

```ts
import { Pawn } from "@clockwyrks/structured-3d";
import { TAGS } from "../../src/constants";

const paddles = world.byTag(TAGS.paddle);
expect(paddles).toHaveLength(2);

const ball = world.byTag(TAGS.ball)[0];
expect(ball.alive).toBe(true);
expect(ball.transform.position.x).toBeCloseTo(0, 3);
expect(ball.transform.position.z).toBeCloseTo(0, 3);

expect(world.find(Pawn)).not.toBeNull();
```

A build names its own actor classes, so the case fixes the tag vocabulary in
`constants.ts` and a build applies those tags through the `tags` of an
`ActorSpec` or a `SpawnSpec`. `ofType` and `find` stay useful for the framework classes every
build shares, `Pawn` above all, which is how a check reaches the thing a
controller possesses without knowing what the build called it.

## Transforms in assertions

An actor's `transform` is a position in
world units, a rotation as a unit quaternion, and a scale, and a check states a
claim about each in the form that survives how a build computed it. A position
is asserted per component with a tolerance, or as a `distance` from a known
point. A rotation is asserted as the direction it faces, `quatRotate` applied
to `FORWARD`, or as a heading read back through `quatToEuler`, because a
quaternion and its negation are one rotation and compare unequal field by
field.

```ts
import { FORWARD, distance, quatRotate, quatToEuler } from "@clockwyrks/structured-3d";

const ship = world.byTag(TAGS.ship)[0];
const goal = world.byTag(TAGS.goal)[0];

expect(distance(ship.transform.position, goal.transform.position)).toBeLessThan(2);

const facing = quatRotate(ship.transform.rotation, FORWARD);
expect(facing.x).toBeCloseTo(1, 3);
expect(quatToEuler(ship.transform.rotation).y).toBeCloseTo(-Math.PI / 2, 3);
```

A component sits at its actor's transform composed with its own `offset`, and
`worldTransform()` returns that composition as a fresh record, so a claim about
where a collider or a mesh sits reads the component rather than the actor. The
[math](/engines/structured-3d/apis/math/) page specifies the helpers and the
`YXZ` order a heading is read in.

## Player states and scores

`world.state.players` holds every player state in index order, a bot's alongside
a player's, and each carries the index, the name, and the score.
`world.players()` returns the player controllers alone, also in index order, and
every controller reaches its own state through `controller.playerState`.

```ts
const [p1, p2] = world.state.players;

expect(p1.index).toBe(0);
expect(p1.score).toBe(3);
expect(p2.name).toBe("CPU");
expect(world.players()[0].playerState).toBe(p1);
```

A game carries its own per-player figures by subclassing `PlayerState`, so a
check that is about a figure the case fixed reads it off the same object once
the case has stated that the figure lives there.

## Driving a pawn

Input reaches the simulation through a player controller alone, so a player
pawn and an AI pawn are the same class driven by two different controllers, and
a check exercises a pawn by writing the controller that drives it. A
controller's intent in three dimensions is a
`Vec3`, and the scripted controller applies it to the pawn's position through
the math helpers.

```ts
import {
  AIController,
  VEC3_ZERO,
  add,
  scale,
  vec3,
  type Vec3,
} from "@clockwyrks/structured-3d";
import { PADDLE_SPEED } from "../../src/constants";

class Scripted extends AIController {
  drive: Vec3 = VEC3_ZERO;

  override tick(dt: number): void {
    if (this.pawn === null) return;
    this.pawn.transform.position = add(
      this.pawn.transform.position,
      scale(this.drive, PADDLE_SPEED * dt),
    );
  }
}
```

[`world.mode.addBot`](/engines/structured-3d/apis/game-mode/) is how that
controller joins the world. Naming `pawn: null` keeps it from spawning one of
its own, and `possess` then hands it the pawn the check wants driven.

```ts
const paddle = world.byTag(TAGS.paddleP2)[0] as Pawn;
const bot = world.mode.addBot(Scripted, { name: "check", pawn: null }) as Scripted;

bot.possess(paddle);
bot.drive = vec3(0, -1, 0);

const before = paddle.transform.position.y;
await engine.advance(30);

expect(paddle.controller).toBe(bot);
expect(paddle.transform.position.y).toBeLessThan(before);
```

`possess` unpossesses whatever the controller held and whatever held the pawn,
notifies the pawn through `possessedBy`, and emits `possession:changed` carrying
the controller, the new pawn, and the previous one. Controllers tick before any
actor, so the pawn's own tick observes what the scripted controller applied in
the same frame.

## Observing a transition

A transition emits three events in a fixed order: `world:opening` before
anything is torn down, `world:closed` once every controller, actor, and the game
mode have ended play, and `world:opened` once the incoming world is built and
its game mode has begun play. Subscriptions live on the engine, so one taken
before `initialize` observes the start level being built as well.

```ts
const { engine } = createHarness();
const seen: string[] = [];
engine.events.on("world:opening", ({ from, to }) => {
  seen.push(`opening ${from} -> ${to}`);
});
engine.events.on("world:closed", ({ level }) => seen.push(`closed ${level}`));
engine.events.on("world:opened", ({ level }) => seen.push(`opened ${level}`));

await engine.initialize();
engine.world.open(LEVELS.match, { round: 2 });
await engine.advance(1);

expect(seen).toEqual([
  "opening null -> title",
  "opened title",
  "opening title -> match",
  "closed title",
  "opened match",
]);
```

The first open carries `from: null` and closes nothing, because there was no
outgoing world. A handler on `world:opened` reads a world whose declared actors
and game mode have already begun play, so it asserts on a finished world rather
than a half-built one.

## What crossed the transition

The game instance is the one framework object that outlives a transition, so a
check reads it on both sides and asserts it is the same object. The world, its
game mode, its game state, its camera, and every actor, component, and
controller are rebuilt, and `world.time` restarts at zero.

```ts
const instance = engine.instance;

engine.world.open(LEVELS.match, { round: 2 });
await engine.advance(1);

const world = engine.world;
expect(engine.instance).toBe(instance);
expect(world.level).toBe(LEVELS.match);
expect(world.time).toBe(0);
expect(world.mode.options).toEqual({ round: 2 });
expect(world.camera.target).toBeNull();
```

A value the case requires to survive travel is read off the instance by name,
because that is where a build must keep it. The frame counter and the
accumulated simulated time cross the transition too, so `engine.frame().count`
keeps climbing across it.

```ts
const carried = engine.instance as GameInstance & { round: number };
expect(carried.round).toBe(2);
```

## Awaiting a transition

`world.open` requests a transition rather than performing one. The request is
honored once the frame's ticks and collision are finished, before the frame
renders, and one request per frame is honored, so a second call in the same
frame replaces the first.

A transition is asynchronous, because the incoming level's `load` is awaited
before its world is built. `engine.advance` awaits it before the next frame, so
the single `advance` above resolves with the new world open, its assets loaded,
and its actors and game mode having begun play. A check polls nothing and sleeps
on nothing; it steps one frame and reads `engine.world` again.
