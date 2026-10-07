// @vitest-environment node
/**
 * `@clockwyrks/structured-2d`'s recorder against this player, over real
 * pixels.
 *
 * Structured 2D writes the same recording format 1 through its own
 * `ContextRecorder`, and its recordings are replayed by the same console
 * player — so it carries exactly the drift risk `recordingParity.test.ts`
 * exists to catch, and gets exactly the same four-surface treatment. The whole
 * differential suite lives in {@link ./recordingParitySuite}; this file only
 * binds it to this engine's recorder, whose construction and frame bracket
 * (`start`/`beginFrame`/`endFrame`/`stop` around the wrapped context) match the
 * surface the suite drives. In the engine proper the rendering pipeline is what
 * draws through the recorded context, but the recorder itself is drivable
 * directly, and that is how its own `recording.test.ts` exercises it too.
 */

import { ContextRecorder } from "@clockwyrks/structured-2d/recording";
import { describeRecordingParity } from "./recordingParitySuite";

describeRecordingParity((ctx) => new ContextRecorder(ctx));
