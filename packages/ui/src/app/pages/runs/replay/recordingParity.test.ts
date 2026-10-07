// @vitest-environment node
/**
 * `@clockwyrks/simple-2d`'s recorder against this player, over real pixels.
 *
 * The whole differential suite — the rig, the scenarios, the generator, and the
 * long account of why it runs in Node over `@napi-rs/canvas`, must not move to
 * a browser, and holds the engine as a test-only development dependency — lives
 * in {@link ./recordingParitySuite}. This file binds it to the engine whose
 * drift against `format.ts` it was first written to catch; the recorder is
 * driven directly, the way the engine itself brackets a frame.
 */

import { ContextRecorder } from "@clockwyrks/simple-2d/recording";
import { describeRecordingParity } from "./recordingParitySuite";

describeRecordingParity((ctx) => new ContextRecorder(ctx));
