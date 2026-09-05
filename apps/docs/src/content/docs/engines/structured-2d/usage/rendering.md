---
title: Rendering
---

An actor becomes visible by carrying a render component. Attach the component in
the actor's constructor, and the pipeline draws it every frame at the actor's
transform, in world units, under whatever mode the renderer is in.

The layers and the palette a case fixes belong in one module the whole build
reads:

```ts
// ./constants.ts
export const LAYER = { field: 0, actors: 10, effects: 20, hud: 30 } as const;

export const PALETTE = {
  ball: "#7fd1ff",
  hud: "#ffffff",
  trail: "#f5d76e",
} as const;
```

## A shape

`ShapeComponent` draws a rect, a circle, or a polygon, centered on the
component's transform.

```ts
import { Actor, ShapeComponent } from "@clockwyrks/structured-2d";
import { LAYER, PALETTE } from "./constants";

export class Ball extends Actor {
  readonly body: ShapeComponent;

  constructor() {
    super();
    this.body = this.attach(
      new ShapeComponent({
        shape: { kind: "circle", radius: 6 },
        fill: PALETTE.ball,
      }),
    );
    this.body.layer = LAYER.actors;
  }
}
```

`fill` and `stroke` both default to `null`, and a component with neither draws
nothing, so set at least one. `strokeWidth` defaults to `1` and is in world
units like the shape itself. A polygon's points are world units relative to the
component's transform.

## A sprite

An image a level needs is loaded in that level's `load`, which the engine awaits
before any actor exists. Hold the loaded images in a module the actors read:

```ts
// ./textures.ts
export const textures: Record<string, ImageBitmap> = {};
```

```ts
// ./levels.ts
import type { LevelDefinition } from "@clockwyrks/structured-2d";
import { Match } from "./mode";
import { Ship } from "./ship";
import { textures } from "./textures";

export const arena: LevelDefinition = {
  mode: Match,
  actors: [{ type: Ship, transform: { x: 320, y: 180 }, tags: ["ship"] }],
  async load(api) {
    textures.ship = await api.assets.loadImage("ship.png");
  },
};
```

The component then reads the image as a plain value:

```ts
import { Actor, SpriteComponent } from "@clockwyrks/structured-2d";
import { LAYER } from "./constants";
import { textures } from "./textures";

export class Ship extends Actor {
  readonly sprite: SpriteComponent;

  constructor() {
    super();
    this.sprite = this.attach(
      new SpriteComponent({ image: textures.ship, width: 32, height: 32 }),
    );
    this.sprite.layer = LAYER.actors;
  }
}
```

`width` and `height` are world units and default to the source region's pixel
size, so give them whenever the design field's units differ from the image's
pixels. `anchorX` and `anchorY` default to `0.5`, which centers the sprite on
its transform.

The viewport fit still scales a sprite drawn at its pixel size, and by default
the scaled image is resampled bilinearly. Pixel art stays crisp by creating the
engine with `imageSmoothing: false`, which samples every image the pipeline
draws nearest-neighbor:

```ts
const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  game,
  imageSmoothing: false,
});
```

A sheet is one image with a `source` region selecting the frame, and the region
is a field the actor writes:

```ts
private elapsed = 0;

tick(dt: number): void {
  this.elapsed += dt;
  const frame = Math.floor(this.elapsed * 12) % 4;
  this.sprite.source = { x: frame * 16, y: 0, width: 16, height: 16 };
}
```

## Text

`TextComponent` draws one string at the component's transform. `font` defaults
to `"16px sans-serif"`, `fill` to `"#ffffff"`, `align` to `"center"`, and
`baseline` to `"middle"`.

```ts
import { Actor, TextComponent } from "@clockwyrks/structured-2d";
import { LAYER, PALETTE } from "./constants";

export class Scoreboard extends Actor {
  readonly label: TextComponent;

  constructor() {
    super();
    this.label = this.attach(
      new TextComponent({
        text: "0 - 0",
        font: "24px monospace",
        fill: PALETTE.hud,
      }),
    );
    this.label.layer = LAYER.hud;
  }

  tick(): void {
    const scores = this.world.state.players.map((player) => player.score);
    this.label.text = scores.join(" - ");
  }
}
```

The font size is world units and is scaled by the camera like every other drawn
quantity. A readout that holds its place while the camera moves draws in screen
space instead. Set `space` to `"screen"`, and the component's transform, its
`offset`, and its font size are logical units measured from the top-left of the
design field:

```ts
this.label.space = "screen";
this.label.offset.x = WIDTH / 2;
this.label.offset.y = 30;
```

A `screen` component keeps its `layer` in the same sort as every `world`
component, so the scoreboard still draws on the HUD layer above the field. A
HUD is an actor whose components all take `screen` space, each offset to its
logical position.

## Choosing layers

`layer` defaults to `0` and orders the whole pipeline. Number the layers in one
place, leave gaps between them, and give every component a layer from that
table rather than a literal.

Within a layer the pipeline orders by the owning actor's spawn order and then by
attachment order, and the sort is stable. Two components that must overlap in a
fixed order therefore belong on two layers, or on one actor attached in the
order they should draw.

## Opacity, tint, and visibility

Every render component carries `layer`, `visible`, and `opacity`. `visible`
defaults to `true`, and `opacity` defaults to `1` and is clamped to `0..1`. A
sprite adds `tint`, and `null` drops it.

```ts
private invulnerable = 0;

tick(dt: number): void {
  this.invulnerable = Math.max(0, this.invulnerable - dt);

  if (this.invulnerable > 0) {
    this.sprite.visible = Math.floor(this.invulnerable * 10) % 2 === 0;
    this.sprite.tint = PALETTE.hud;
  } else {
    this.sprite.visible = true;
    this.sprite.tint = null;
  }
}
```

`visible` takes a component out of the picture and leaves it ticking. The
component's own `enabled` is the wider switch: a disabled component skips its
tick, draws nothing, and takes no part in collision.

## Following an actor with the camera

Attach a `CameraComponent` to the actor the view should follow, and point the
world's camera at that actor. Each frame the camera takes the world transform
and zoom of the first enabled `CameraComponent` the target holds, then clamps
the result to `camera.bounds`. The ship above becomes the view target by
attaching the component and following itself:

```ts
constructor() {
  super();
  this.sprite = this.attach(
    new SpriteComponent({ image: textures.ship, width: 32, height: 32 }),
  );
  this.sprite.layer = LAYER.actors;
  this.attach(new CameraComponent({ zoom: 1.5 }));
}

beginPlay(): void {
  this.world.camera.follow(this);
  this.world.camera.bounds = { x: 0, y: 0, width: 2048, height: 1152 };
}
```

The component's `offset` shifts the view relative to its actor, so a camera that
leads the ship is an offset rather than a second actor. `follow(null)` releases
the target and leaves the camera wherever the game writes it.

## Drawing directly

A case that measures the drawing itself uses a `DrawComponent`. The engine calls
`draw` in the component's place in the layer order, with the context already
carrying the transform of the component's `space`, so a `world` component draws
in world units and a `screen` component in logical units. `api.space` names
which.

Render modes belong to the declarative pipeline, so a `DrawComponent` reads
`api.mode` and supplies its own.

```ts
import {
  DrawComponent,
  type DrawApi,
  type Vec2,
} from "@clockwyrks/structured-2d";
import { PALETTE } from "./constants";

export class Trail extends DrawComponent {
  private readonly points: Vec2[] = [];

  tick(): void {
    const at = this.worldTransform();
    this.points.push({ x: at.x, y: at.y });
    if (this.points.length > 48) this.points.shift();
  }

  draw(api: DrawApi): void {
    if (this.points.length < 2) return;
    const { ctx } = api;

    ctx.save();
    ctx.beginPath();
    this.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });

    if (api.mode === "wireframe") {
      ctx.lineWidth = 1;
      ctx.strokeStyle = PALETTE.hud;
    } else {
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTE.trail;
      ctx.globalAlpha = api.mode === "shaded" ? this.opacity : 1;
    }

    ctx.stroke();
    ctx.restore();
  }
}
```

Attach it like any other render component, and give it a layer:

```ts
constructor() {
  super();
  const trail = this.attach(new Trail());
  trail.layer = LAYER.effects;
}
```

Balance `save` and `restore` around a transformed or restyled subtree, so the
components drawn after it start from the transform and the styles the pipeline
handed over.

## Switching the mode

The renderer's two switches are reached from the engine and take effect on the
next frame:

```ts
engine.renderer.setMode("wireframe");
engine.renderer.setCollisionOverlay(true);
```

Wireframe shows the geometry a build placed and silhouette shows how it layered
that geometry, so both are worth looking at while the picture is being built.
