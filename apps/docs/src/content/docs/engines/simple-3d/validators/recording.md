---
title: Recording
---

A suite holds the engine it is stepping, so it can capture the frames a build
drew over exactly the stretch of a scenario its check is about. That capture is
a [recording](/engines/simple-3d/concepts/recording/): the scene the build
submitted each frame, as its draws, lights, scene settings, and camera, and the
operations it issued against the screen layer, which a player rebuilds and
renders to reproduce the picture. A verdict unit declares a `replay` output, the
suite produces it, and the runner collects it as the review item's media.

## Declaring the output

A verdict unit declares its media in the case
[manifest](/testing/end-to-end/manifests/), and a validator's evidence is
declared as `kind = "replay"`.

```toml
[[review_item]]
id = "delivery"
title = "Delivery"
weight = 1
validation = { script = "delivery.test.ts", outputs = [
  { id = "set-down", name = "Crate set down on the truck bed", kind = "replay" },
] }
```

A suite may declare several. The one-video-per-script rule covers a browser
drive, which records one screen capture per script; a recording is armed and
disarmed by the suite itself, so a suite that walks through three scenarios
declares an output for each.

## Arming around the section under test

Setup runs the real game forward, which is frames the check is not about. Arm
the recorder once the scenario is posed and disarm it once the behavior has
happened, so the reviewer's evidence opens on the situation the requirement
describes.

```ts
import { expect, it } from "vitest";
import { BED_Y, TRUCK_X, TRUCK_Z } from "../src/constants";
import { createHarness, startShift } from "../harness";
import { emitReplay } from "../replay";

it("credits a crate set down on the truck bed", async () => {
  const h = createHarness();
  const { engine } = h;
  await engine.initialize();

  startShift(h, "timed");
  h.setHookPosition(TRUCK_X, BED_Y + 4, TRUCK_Z);
  h.setHeldCrate(3);
  h.setHookVelocity(0, -4, 0);
  await engine.advance(30);

  engine.startRecording();
  await engine.advance(60);
  emitReplay(import.meta.url, "set-down", engine.stopRecording());

  expect(h.snapshot().score).toBe(1);
});
```

The recording is taken before the assertions run, so a failing check still hands
the reviewer the frames that failed it.

Capture depends on nothing a renderer does. The harness runs the `headless`
backend, and the recorder captures the scene from the scene object and the
screen layer from its context, so the recording a suite emits is the one the
same frames would have produced in a browser, and a player renders it through
its own renderer.

Call `stopRecording` on every path that armed the recorder. A suite that arms it
twice without stopping in between is refused by the engine, which reports the
unbalanced call rather than discarding the frames the check was about.

## Writing the output

The runner creates the run's media directory before vitest starts and names it
to the suites in the `TCAB_VALIDATION_MEDIA_DIR` environment variable, as an
absolute path. A suite writes each declared output to
`$TCAB_VALIDATION_MEDIA_DIR/<its own staged path>/<output id>.replay`.

A recording is a zip archive, which is what the extension names. `stopRecording`
returns a `Recording` holding the document, the buffers, the embedded maps, and
the referenced assets, and `packRecording` builds the archive from it. The
document, `recording.json`, is small: tables of references, scalars, and
indices, where a frame names its scene entry, camera, lights, draws, and the
screen layer's inherited state and operations by index into tables the whole
recording shares, so a frame is drawable on its own and the frames that repeat
each other cost an index apiece.

The buffers hold what moved. `frames.bin` carries every matrix and morph
influence the frames name by span, `geometry.bin` the attributes of every
embedded geometry, and both are shared on their bytes, so a still object costs
one span for the whole recording and a moving one costs a span per pose. Every
asset a recorded frame references is carried once, byte for byte, under the
SHA-256 of its bytes, however many draws and frames name it, and a material
image the build made itself travels as one PNG per distinct content.
Serving keeps the archive as it is: a recording goes out as
`application/octet-stream`.

Four budgets bound the archive, each counted over the bytes it will hold:
embedded geometry at 16 MB, embedded maps at 16 MB, `frames.bin` at 64 MB, and
referenced assets at 128 MB. A frame that would take the recording past any of
them is not recorded and no later frame is either, so every frame the archive
holds is whole. The document then carries an `ended` mark naming the engine
frame counter of the first frame not held and the budget it hit, the recorder
stays armed until `stopRecording`, and a player shows where and why the
recording ended. A suite that records a scene rewriting its geometry every
frame, or a build that loads a large set of models, reads the mark to know
whether the evidence covers the whole section its assertions did.

The staged path is the path the runner handed vitest as a file filter, so a
suite derives its own from `import.meta.url` and needs no name of its own. Two
suites of the same name in different directories therefore cannot collide, and
nothing has to be escaped or flattened by the suite. A case writes this once,
beside its harness:

```ts
// validation/replay.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { packRecording, type Recording } from "@test-cabinet/simple-3d";

const WORKSPACE = fileURLToPath(new URL("..", import.meta.url));

export function emitReplay(
  suite: string,
  output: string,
  recording: Recording,
): void {
  const dir = process.env.TCAB_VALIDATION_MEDIA_DIR;
  if (dir === undefined) return;
  if (recording.document.frames.length === 0) return;

  const staged = relative(WORKSPACE, fileURLToPath(suite));
  const target = join(dir, staged, `${output}.replay`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, packRecording(recording));
}
```

The variable is absent when the suites are run by hand, which is how a case
author runs them while writing them. Writing nothing then keeps a local `vitest
run` to its assertions.

A capture that closed no frames is left unwritten, and the run reports the
output absent.

Once vitest returns, the runner moves each declared output to the flat
`<verdict>__<output>.replay` name every consumer of validation media addresses,
and records whether it was there. An output that is not there is recorded absent
rather than failing anything: the assertions decide the point, and media is the
evidence beside the verdict.

## The baseline

The same suites are run against the variant's reference implementation for the
same engine by [`tcab capture-baselines`](/components/cli/overview/#commands),
which produces the baseline recording under the same name in the case's version
folder, at `validation-baseline/<engine>/<variant>/`. The reviewer sees the two
beside each other.

The engine is in that path because a variant has one reference implementation
per engine, and the two are different builds, so a run is compared against the
baseline recorded under its own engine.

Both recordings carry the engine's frame counter and its accumulated simulated
time per frame, and every frame in each is drawn from itself alone, so one
control scrubs both in step. A scenario that runs the same number of frames
under the same scripted clock in both places puts the two pictures on the same
frame throughout.

## Choosing a recording

A recording is the whole stretch of a scenario as the build drew it, which is
what a reviewer wants when the requirement is about motion or sequence: how the
hook lowered onto the crate, how the camera swung to follow it, what the
transition between two states looked like, whether an effect played where it
should have.

[The scene, the projection, the screen layer's pixels, and its draw-call
stream](/engines/simple-3d/validators/rendering/) are how a check states
its claim, because a claim needs a value to assert against. Recording is what
the reviewer looks at afterwards, so a suite records the section its assertions
cover rather than recording in place of making them.
