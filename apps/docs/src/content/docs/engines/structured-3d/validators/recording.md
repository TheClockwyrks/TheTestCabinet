---
title: Recording
---

A suite holds the engine it is stepping, so it can capture the frames a build
drew over exactly the stretch of a scenario its check is about. That capture is
a [recording](/engines/structured-3d/concepts/recording/): the operations the
build issued, which a player re-issues to reproduce the picture. A verdict unit
declares a `replay` output, the suite produces it, and the runner collects it as
the review item's media.

## Declaring the output

A verdict unit declares its media in the case
[manifest](/testing/end-to-end/manifests/), and a validator's evidence is
declared as `kind = "replay"`.

```toml
[[review_item]]
id = "scoring-point"
title = "Scoring"
weight = 1
validation = { script = "scoring-point.test.ts", outputs = [
  { id = "goal", name = "Ball crosses the goal end", kind = "replay" },
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
import { createHarness } from "../harness";
import { emitReplay } from "../replay";

it("credits the left player when the ball crosses the right end", async () => {
  const { engine } = createHarness();
  await engine.initialize();

  engine.debug.startMatch("versus");
  engine.debug.placeBall({
    position: { x: 22, y: 0, z: 0 },
    velocity: { x: 10, y: 0, z: 0 },
  });
  await engine.advance(30);

  engine.startRecording();
  await engine.advance(60);
  emitReplay(import.meta.url, "goal", engine.stopRecording());

  expect(engine.world.state.players[0].score).toBe(1);
});
```

The recording is taken before the assertions run, so a failing check still hands
the reviewer the frames that failed it. That is the case a recording is most
valuable in: the verdict says the point was missed and the evidence shows what
the build drew instead.

Call `stopRecording` on every path that armed the recorder. A suite that arms it
twice without stopping in between is refused by the engine, which reports the
unbalanced call rather than discarding the frames the check was about.

## Writing the output

The runner creates the run's media directory before vitest starts and names it
to the suites in the `TCAB_VALIDATION_MEDIA_DIR` environment variable, as an
absolute path. A suite writes each declared output to
`$TCAB_VALIDATION_MEDIA_DIR/<its own staged path>/<output id>.json.gz`.

A recording is a JSON document stored gzipped, which is what the two extensions
say. A frame names the renderer state it inherited and the operations it issued
by index into tables the whole recording shares, so a frame is drawable on its
own and the frames that repeat each other cost an index apiece. The meshes and
textures the operations drew are embedded in the same document, each captured
once however many frames draw it, so a replay needs nothing from the run's
tree; the asset bytes are the bulk of a capture, and the operations beside them
compress away because a game's operations differ from their neighbours' by a
few coordinates. The document inside is the recording exactly as the recorder
handed it back — its `space: "3d"` is what routes it to the player's 3D drawer
— and serving keeps that reading: a recording goes out as `application/json`
with `Content-Encoding: gzip`.

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
import { gzipSync } from "node:zlib";
import type { Recording } from "@test-cabinet/structured-3d";

const WORKSPACE = fileURLToPath(new URL("..", import.meta.url));

export function emitReplay(
  suite: string,
  output: string,
  recording: Recording,
): void {
  const dir = process.env.TCAB_VALIDATION_MEDIA_DIR;
  if (dir === undefined) return;
  if (recording.frames.length === 0) return;

  const staged = relative(WORKSPACE, fileURLToPath(suite));
  const target = join(dir, staged, `${output}.json.gz`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, gzipSync(JSON.stringify(recording)));
}
```

The variable is absent when the suites are run by hand, which is how a case
author runs them while writing them. Writing nothing then keeps a local `vitest
run` to its assertions.

A capture that closed no frames is left unwritten. The run then reports the
output absent, which is the truthful reading of a section that drew nothing; a
file holding an empty frame list would instead announce a replay and open the
player on nothing.

Once vitest returns, the runner moves each declared output to the flat
`<verdict>__<output>.json.gz` name every consumer of validation media addresses,
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
per engine, and the two are different builds. A run recorded under one engine
compared against the other's frames would show a reviewer a difference between
two runtimes and invite them to read it as a difference in the build.

Both recordings carry the engine's frame counter and its accumulated simulated
time per frame, and every frame in each is drawn from itself alone, so one
control scrubs both in step. A scenario that runs the same number of frames
under the same scripted [clock](/engines/structured-3d/apis/clocks/) in both
places puts the two pictures on the same frame throughout.

## Choosing a recording

A recording is the whole stretch of a scenario as the build drew it, which is
what a reviewer wants when the requirement is about motion or sequence: how the
ball left the paddle, what the transition between two states looked like,
whether an effect played where it should have.

[The recorded frame and pixel
readback](/engines/structured-3d/validators/rendering/) remain how a check
states its claim, because a claim needs a value to assert against. Recording is
what the reviewer looks at afterwards, so a suite records the section its
assertions cover rather than recording in place of making them.
