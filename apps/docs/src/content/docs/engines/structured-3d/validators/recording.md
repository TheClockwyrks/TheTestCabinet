---
title: Recording
---

A suite holds the engine it is stepping, so it can capture the frames a build
drew over exactly the stretch of a scenario its check is about. That capture is
a [recording](/engines/structured-3d/concepts/recording/): a video of the
frames the engine drew, the world pass with the screen layer over it, one video
frame per engine frame, encoded as VP9 in a WebM container and timestamped in
the engine's simulated time. A verdict unit declares a `replay` output, the
suite produces it, and the runner collects it as the review item's media.

The evidence is the pixels. Chromium renders the world pass in software, so the
recording a suite emits holds every material, shader, shadow, fog, sprite,
post-effect, and screen-space component the pipeline drew, and a player shows
the frames as decoded.

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
  { id = "goal", name = "Ball crosses the goal plane", kind = "replay" },
] }
```

A suite may declare several. A recording is armed and disarmed by the suite
itself, so a suite that walks through three scenarios declares an output for
each.

## Arming around the section under test

Setup runs the real game forward, which is frames the check is not about. Arm
the recorder once the scenario is posed and disarm it once the behavior has
happened, so the reviewer's evidence opens on the situation the requirement
describes.

```ts
import { expect, it } from "vitest";
import { GOAL_X } from "../../src/constants";
import { createHarness } from "../harness";
import { emitReplay } from "../replay";

it("credits the left player when the ball crosses the far goal plane", async () => {
  const { engine } = createHarness();
  await engine.initialize();

  engine.debug.startMatch("versus");
  engine.debug.setBallPosition(GOAL_X - 6, 0, 0);
  engine.debug.setBallVelocity(8, 0, 0);
  await engine.advance(30);

  engine.startRecording();
  await engine.advance(60);
  await emitReplay("goal", await engine.stopRecording());

  expect(engine.world.state.players[0].score).toBe(1);
});
```

The recording is taken before the assertions run, so a failing check still hands
the reviewer the frames that failed it. Capture begins at the frame after
`startRecording`, so the sixty frames advanced are the sixty frames recorded,
and `stopRecording` resolves once the encoder has flushed the last of them.

Call `stopRecording` on every path that armed the recorder. A suite that arms it
twice without stopping in between is refused by the engine, which reports the
unbalanced call rather than discarding the frames the check was about.

Capture stops at 3,600 frames, and a recording the bound stopped says so in
`ended`. The recorder stays armed until `stopRecording`, so a suite that records
a long section reads `ended` to know whether the evidence covers the whole of
it.

## Writing the output

The runner creates the run's media directory before vitest starts and names it
to the Node side in the `TCAB_VALIDATION_MEDIA_DIR` environment variable, as an
absolute path. A suite writes each declared output to
`$TCAB_VALIDATION_MEDIA_DIR/<its own staged path>/<output id>.webm`.

A suite runs in the page and the media directory is on disk, so the write
crosses to the Node side through a browser command. The case's
[config](/engines/structured-3d/validators/the-suite/#the-vitest-project)
declares `emitReplay` under `browser.commands`: it receives the suite's absolute
path as `testPath`, derives the staged path from it, and writes the bytes. A
suite therefore needs no name of its own, two suites of the same name in
different directories cannot collide, and nothing has to be escaped or
flattened by the suite.

A case writes the browser-side helper once, beside its harness. It hands the
video bytes across as base64, because a command's arguments cross the page
boundary as JSON.

```ts
// validation/replay.ts
import { commands } from "@vitest/browser/context";
import type { Recording } from "@clockwyrks/structured-3d";

declare module "@vitest/browser/context" {
  interface BrowserCommands {
    emitReplay: (output: string, video: string) => Promise<void>;
  }
}

export async function emitReplay(output: string, recording: Recording): Promise<void> {
  if (recording.frames.length === 0) return;
  await commands.emitReplay(output, toBase64(recording.video));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
```

The variable is absent when the suites are run by hand, which is how a case
author runs them while writing them. The command writes nothing then, which
keeps a local `vitest run` to its assertions.

A capture with no frames is left unwritten, and the run reports the output
absent.

Once vitest returns, the runner moves each declared output to the flat
`<verdict>__<output>.webm` name every consumer of validation media addresses,
and records whether it was there. An output that is not there is recorded absent
rather than failing anything: the assertions decide the point, and media is the
evidence beside the verdict. The file is served as `video/webm`, and the console
steps it frame-exactly through WebCodecs rather than playing it as a clip.

## The baseline

The same suites are run against the variant's reference implementation for the
same engine by [`tcab capture-baselines`](/components/cli/overview/#commands),
which produces the baseline recording under the same name in the case's version
folder, at `validation-baseline/<engine>/<variant>/<item>__<output>.webm`. The
reviewer sees the two beside each other.

The engine is in that path because a variant has one reference implementation
per engine, and the two are different builds, so a run is compared against the
baseline recorded under its own engine.

Both recordings are timestamped in the engine's simulated time, so the review
page indexes each by timestamp and one control scrubs both in step. A scenario
that runs the same number of frames under the same scripted clock in both places
puts the two pictures on the same frame throughout.

## Choosing a recording

A recording is the whole stretch of a scenario as the build drew it, which is
what a reviewer wants when the requirement is about motion or sequence: how the
ball left the paddle, what the transition between two states looked like,
whether an effect played where it should have, how the camera followed its
target.

[The scene, the projection, the stage canvas's pixels, and the screen layer's
pixels and draw-call stream](/engines/structured-3d/validators/rendering/) are
how a check states its claim, because a claim needs a value to assert against.
Recording is what the reviewer looks at afterwards, so a suite records the
section its assertions cover.
