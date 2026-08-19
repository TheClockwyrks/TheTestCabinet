---
title: Audio and Assets
---

Sound and files follow the same shape: the build names things, and the engine
owns everything below the name. Cues are declared once during setup and played
by name from the simulation. Assets are named by a path relative to a fixed
root, and the engine computes the URL.

## Defining cues

Define every cue during setup, before the first frame, so the names the
simulation plays are all live by the time it runs.

```ts
const engine = createEngine({ canvas, width: 640, height: 360 });

engine.audio.define("paddle", { wave: "square", freq: 440, durationMs: 60 });
engine.audio.define("wall", { wave: "square", freq: 220, durationMs: 45 });
engine.audio.define("score", {
  wave: "triangle",
  freq: 520,
  freqTo: 880,
  durationMs: 220,
});
engine.audio.define("lose", {
  wave: "sawtooth",
  freq: 300,
  freqTo: 90,
  gain: 0.3,
  durationMs: 400,
});
```

Each spec is a starting frequency, an optional frequency to sweep to, and a
duration in milliseconds. A gain of `0.2` and a sine wave apply when the spec
names neither.

## Playing cues

Play a cue from `update`, wherever the event it belongs to is detected. The call
returns immediately, is safe several times per frame, and succeeds while muted.

```ts
update(dt: number): void {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.y < 0 || ball.y > 360) {
    ball.vy = -ball.vy;
    engine.audio.play("wall");
  }

  if (hitsPaddle(ball, paddle)) {
    ball.vx = -ball.vx;
    engine.audio.play("paddle");
  }

  if (ball.x > 640) {
    score += 1;
    engine.audio.play("score");
  }
}
```

Play a name that was defined. Playing an undefined name throws, so the check
that catches a typo is the run itself.

## Muting

Every touch layout carries a `mute` action. Register it like any other action
and drive the bus from it:

```ts
if (engine.input.pressed("mute")) {
  engine.audio.setMuted(!engine.audio.muted());
}
```

A muted cue still plays in every sense but audibility: the call succeeds and the
cue is recorded at a gain of zero.

## Loading assets

Put the build's files under `assets/` in the workspace and name them relative to
that directory. `load` fetches one and resolves to a `Blob`.

```ts
async function loadSprite(path: string): Promise<HTMLImageElement> {
  const blob = await engine.assets.load(path);
  const image = new Image();
  image.src = URL.createObjectURL(blob);
  await image.decode();
  return image;
}

const ship = await loadSprite("sprites/ship.png");
```

Load assets before starting the frame loop, or hold the result in a variable the
render guards on, so a frame that runs before the asset arrives still draws.

```ts
let ship: HTMLImageElement | null = null;
void loadSprite("sprites/ship.png").then((image) => {
  ship = image;
});

engine.frame.run({
  update(dt) {
    player.x += player.vx * dt;
  },
  render(ctx) {
    if (ship !== null) ctx.drawImage(ship, player.x, player.y);
  },
});
```

`load` rejects when the path is refused, when the fetch fails, and when the
response status is not `2xx`. Handle the rejection where the build can still
draw something.

## Resolving without loading

`resolve` computes the URL and performs no fetch, which is what to use when the
browser does the loading:

```ts
const img = document.createElement("img");
img.src = engine.assets.resolve("sprites/ship.png"); // "assets/sprites/ship.png"
```

Keep every path relative, with no leading slash, no `..` segment, and no scheme.
A path that would name a location outside `assets/` is refused.

## A build that uses both

```ts
import { createEngine } from "@test-cabinet/simple-2d";

const canvas = document.querySelector<HTMLCanvasElement>("canvas");
if (canvas === null) throw new Error("missing canvas");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#101018",
  layout: "single-vertical",
});

engine.input.register("up", { keys: ["ArrowUp", "KeyW"], kind: "analog" });
engine.input.register("mute", { keys: ["KeyM"] });

engine.audio.define("thrust", { wave: "sawtooth", freq: 90, durationMs: 120 });
engine.audio.define("pickup", {
  wave: "triangle",
  freq: 660,
  freqTo: 990,
  durationMs: 140,
});

const blob = await engine.assets.load("sprites/ship.png");
const ship = new Image();
ship.src = URL.createObjectURL(blob);
await ship.decode();

const player = { x: 320, y: 180, vy: 0 };

engine.frame.run({
  update(dt) {
    if (engine.input.pressed("up")) engine.audio.play("thrust");
    player.vy -= 400 * engine.input.value("up") * dt;
    player.vy += 300 * dt;
    player.y += player.vy * dt;

    if (collectedPickup(player)) engine.audio.play("pickup");
    if (engine.input.pressed("mute")) engine.audio.setMuted(!engine.audio.muted());
  },
  render(ctx) {
    ctx.drawImage(ship, player.x - 16, player.y - 16);
  },
});
```

Setup defines the cues and awaits the sprite before the loop starts. The loop
plays cues by name and draws the loaded image, and neither the audio graph nor
the sprite's URL appears anywhere in the build's code.
