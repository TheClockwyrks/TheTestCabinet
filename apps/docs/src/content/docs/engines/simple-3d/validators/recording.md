---
title: Recording
---

A suite holds the engine it is stepping, so it can capture the frames a build
drew over exactly the stretch of a scenario its check is about. That capture is
a [recording](/engines/simple-3d/concepts/recording/): a video of the frames
the engine drew, the scene rendered through the camera with the screen layer
over it, one video frame per engine frame. A verdict unit declares a `replay`
output, the suite produces it, and the runner collects it as the review item's
media.

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
  await emitReplay("set-down", await engine.stopRecording());

  expect(h.snapshot().score).toBe(1);
});
```

The recording is taken before the assertions run, so a failing check still hands
the reviewer the frames that failed it. `stopRecording` resolves once the
encoder has flushed, and `Recording.frames.length` is the number of video
frames the container holds, so a check that wants the frame count reads it
there: sixty advances after arming are sixty frames.

Call `stopRecording` on every path that armed the recorder. A suite that arms it
twice without stopping in between is refused by the engine, which reports the
unbalanced call rather than discarding the frames the check was about.

## The command and the helper

The suite runs in the page and the media directory is on disk, so writing a
recording crosses from the browser to Node through a vitest browser command.
The case's [vitest config](/engines/simple-3d/validators/the-suite/) registers
`emitReplay` as that command: it receives the output id and the video bytes as
base64, and the suite's absolute path as `testPath`, and writes the file under
the media directory. A case writes the browser-side helper once, beside its
harness.

```ts
// validation/replay.ts
import { commands } from "@vitest/browser/context";
import type { Recording } from "@clockwyrks/simple-3d";

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

The command's `testPath` is the suite's absolute path, so the staged path
derives from it and the suite needs no name of its own and no
`import.meta.url`. Two suites of the same name in different directories
therefore cannot collide, and nothing has to be escaped or flattened by the
suite. A capture with no frames is left unwritten by the helper, and the run
reports the output absent.

## Writing the output

The runner creates the run's media directory before vitest starts and names it
to the command in the `TCAB_VALIDATION_MEDIA_DIR` environment variable, as an
absolute path. The command writes each declared output to
`$TCAB_VALIDATION_MEDIA_DIR/<the suite's staged path>/<output id>.webm`.

A recording is a WebM file, which is what the extension names. Its video
stream is VP9, one frame per engine frame, timestamped in the engine's
simulated time and with a keyframe at least every 60 frames, and a player
decodes it with WebCodecs and steps it frame-exactly. Serving keeps the file as
it is: a recording goes out as `video/webm`, as recorded.

The variable is absent when the suites are run by hand, which is how a case
author runs them while writing them. The command writes nothing then, which
keeps a local `vitest run` to its assertions.

Once vitest returns, the runner moves each declared output to the flat
`<verdict>__<output>.webm` name every consumer of validation media addresses,
and records whether it was there. An output that is not there is recorded absent
rather than failing anything: the assertions decide the point, and media is the
evidence beside the verdict.

## The baseline

The same suites are run against the variant's reference implementation for the
same engine by [`tcab capture-baselines`](/components/cli/overview/#commands),
which runs them the same way, in browser mode on the same Chromium, and
produces the baseline recording under the same name in the case's version
folder, at `validation-baseline/<engine>/<variant>/<item>__<output>.webm`. The
reviewer sees the two beside each other.

The engine is in that path because a variant has one reference implementation
per engine, and the two are different builds, so a run is compared against the
baseline recorded under its own engine.

Both recordings are timestamped in the engine's simulated time, so the review
page indexes both by timestamp and one control scrubs them in step. A scenario
that runs the same number of frames under the same scripted clock in both
places puts the two pictures on the same frame throughout.

## Choosing a recording

A recording is the whole stretch of a scenario as the build drew it, which is
what a reviewer wants when the requirement is about motion or sequence: how the
hook lowered onto the crate, how the camera swung to follow it, what the
transition between two states looked like, whether an effect played where it
should have.

[The scene, the projection, the pixels of either canvas, and the screen
layer's draw-call stream](/engines/simple-3d/validators/rendering/) are how a
check states its claim, because a claim needs a value to assert against.
Recording is what the reviewer looks at afterwards, so a suite records the
section its assertions cover rather than recording in place of making them.
