import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import {
  createContextlessCanvas,
  createStage,
  createStubCanvas,
  installCanvasContexts,
} from "./canvas";
import { hasCodecs, installCodecs } from "./codecs";

/**
 * The harness, checked against the thing it exists to carry.
 *
 * Every later suite in this package rests on these stubs, so the claims worth
 * making here are the ones a subsystem test would otherwise have to make by
 * accident: that a real `THREE.WebGLRenderer` constructs over the stubbed context
 * and renders through it, that the calls a test reads the picture's placement from
 * are actually recorded, that the 2D context keeps what was drawn on it, and that
 * the WebCodecs stubs come and go without leaving anything on the global object.
 *
 * A failure here means the harness stopped standing in for what it claims to stand
 * in for — most likely because three began asking the context something new — and
 * every other suite's failure would be a symptom of it.
 */

const disposables: THREE.WebGLRenderer[] = [];

afterEach(() => {
  for (const renderer of disposables.splice(0)) renderer.dispose();
});

/** A renderer over a stub canvas, disposed of whatever the test does with it. */
function build(
  width = 640,
  height = 360,
): {
  renderer: THREE.WebGLRenderer;
  stub: ReturnType<typeof createStubCanvas>;
} {
  const stub = createStubCanvas({ width, height });
  const renderer = new THREE.WebGLRenderer({ canvas: stub.canvas });
  disposables.push(renderer);
  return { renderer, stub };
}

/** A scene with one lit mesh in front of a camera, which is a picture to draw. */
function scene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const built = new THREE.Scene();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4488ff }),
  );
  built.add(mesh);
  built.add(new THREE.AmbientLight(0xffffff, 0.4));
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(2, 3, 4);
  built.add(light);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  return { scene: built, camera };
}

describe("the WebGL2 stub", () => {
  it("is what a renderer constructs over", () => {
    const { renderer, stub } = build();

    expect(renderer.getContext()).toBe(stub.gl.gl);
    // The version string is the one thing three refuses a context over: it parses
    // the major version off it and treats anything else as unsupported.
    expect(renderer.capabilities.isWebGL2).toBe(true);
  });

  it("gives every constant its own number, in both directions", () => {
    const { stub } = build();

    const scissor = stub.gl.constant("SCISSOR_TEST");
    expect(stub.gl.constant("SCISSOR_TEST")).toBe(scissor);
    expect(stub.gl.constant("DEPTH_TEST")).not.toBe(scissor);
    expect(stub.gl.constantName(scissor)).toBe("SCISSOR_TEST");
  });

  it("tracks the canvas's backing store through the drawing buffer", () => {
    const { renderer, stub } = build();

    renderer.setSize(320, 200, false);

    expect(stub.canvas.width).toBe(320);
    expect(stub.gl.gl.drawingBufferWidth).toBe(320);
    expect(stub.gl.gl.drawingBufferHeight).toBe(200);
  });

  it("records the viewport a size or a viewport call placed", () => {
    const { renderer, stub } = build();

    renderer.setSize(400, 300, false);
    stub.gl.forget();
    renderer.setViewport(10, 20, 100, 50);

    expect(stub.gl.lastCall("viewport")?.args).toEqual([10, 20, 100, 50]);
  });

  it("records the scissor rectangle and the enable that turned it on", () => {
    const { renderer, stub } = build();
    stub.gl.forget();

    renderer.setScissor(4, 8, 16, 32);
    renderer.setScissorTest(true);

    expect(stub.gl.lastCall("scissor")?.args).toEqual([4, 8, 16, 32]);
    const enabled = stub.gl
      .callsTo("enable")
      .some((call) => call.args[0] === stub.gl.constant("SCISSOR_TEST"));
    expect(enabled).toBe(true);

    stub.gl.forget();
    renderer.setScissorTest(false);
    const disabled = stub.gl
      .callsTo("disable")
      .some((call) => call.args[0] === stub.gl.constant("SCISSOR_TEST"));
    expect(disabled).toBe(true);
  });

  it("records what the surface was cleared to", () => {
    const { renderer, stub } = build();
    stub.gl.forget();

    renderer.setClearColor(0x102030, 1);
    renderer.clear();

    // The channels are three's own, so they carry its conversion out of sRGB into
    // the working colour space rather than the byte the hex named; what is checked
    // is that the call carried the colour and reached the stub, not the transfer
    // function three applied on the way.
    const cleared = stub.gl.lastCall("clearColor")?.args as number[];
    expect(cleared[0]).toBeCloseTo(0x10 / 0xff, 4);
    expect(cleared[1]).toBeCloseTo(0x20 / 0xff, 4);
    expect(cleared[2]).toBeCloseTo(0x30 / 0xff, 4);
    expect(cleared[3]).toBe(1);
    expect(stub.gl.callsTo("clear").length).toBeGreaterThan(0);
  });

  it("renders a lit mesh through to a draw call", () => {
    const { renderer, stub } = build();
    const { scene: built, camera } = scene();

    renderer.render(built, camera);

    expect(renderer.info.render.calls).toBeGreaterThan(0);
    expect(renderer.info.render.triangles).toBeGreaterThan(0);
    const drew =
      stub.gl.callsTo("drawElements").length +
      stub.gl.callsTo("drawArrays").length;
    expect(drew).toBeGreaterThan(0);
  });

  it("renders again after the canvas is resized", () => {
    const { renderer } = build();
    const { scene: built, camera } = scene();

    renderer.render(built, camera);
    renderer.setSize(200, 200, false);
    renderer.render(built, camera);

    expect(renderer.info.render.calls).toBeGreaterThan(0);
  });

  it("is disposed of without complaint", () => {
    const { renderer } = build();
    const { scene: built, camera } = scene();
    renderer.render(built, camera);

    expect(() => {
      renderer.dispose();
    }).not.toThrow();
  });

  it("stops recording once the cap is reached, so a long run stays bounded", () => {
    const stub = createStubCanvas({ gl: { maxCalls: 3 } });

    for (let at = 0; at < 10; at += 1) stub.gl.gl.viewport(at, 0, 1, 1);

    expect(stub.gl.calls.length).toBe(3);
  });
});

describe("the canvas helpers", () => {
  it("hands out the same context on every read, and nothing for an id it has not got", () => {
    const stub = createStubCanvas();

    expect(stub.canvas.getContext("webgl2")).toBe(stub.gl.gl);
    expect(stub.canvas.getContext("2d")).toBe(stub.context2d.ctx);
    expect(stub.canvas.getContext("webgl")).toBeNull();
  });

  it("reports the laid-out size jsdom would give as zero", () => {
    const stub = createStubCanvas({ cssWidth: 1024, cssHeight: 768 });

    expect(stub.canvas.clientWidth).toBe(1024);
    expect(stub.canvas.clientHeight).toBe(768);
  });

  it("offers a canvas whose context cannot be had", () => {
    expect(createContextlessCanvas().getContext("webgl2")).toBeNull();
  });

  it("records 2D operations with the transform and fill in force for each", () => {
    const stub = createStubCanvas();
    const ctx = stub.context2d.ctx;

    ctx.save();
    ctx.setTransform(2, 0, 0, 2, 5, 5);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 10, 10);
    ctx.fillText("score", 1, 2);
    ctx.restore();

    expect(stub.context2d.names()).toEqual([
      "save",
      "setTransform",
      "fillRect",
      "fillText",
      "restore",
    ]);
    const [filled] = stub.context2d.opsOf("fillRect");
    expect(filled?.fill).toBe("#ff0000");
    expect(filled?.transform).toEqual([2, 0, 0, 2, 5, 5]);
    expect(stub.context2d.opsOf("fillText")[0]?.text).toBe("score");
    // The overlay lays out against a measurement, so one has to come back.
    expect(ctx.measureText("score").width).toBe(35);
  });

  it("gives every canvas the document makes a context of its own", () => {
    // jsdom's own `getContext` is what the patch replaces, so the identity of the
    // prototype method is how the restoration is checked. Calling it afterwards
    // would work too, but jsdom answers a call it cannot serve by logging a page of
    // "not implemented" to stderr, which is noise every later suite would inherit.
    const jsdomGetContext = HTMLCanvasElement.prototype.getContext;
    const installed = installCanvasContexts();
    try {
      const first = document.createElement("canvas");
      const second = document.createElement("canvas");
      const ctx = first.getContext("2d");
      ctx?.fillRect(0, 0, 1, 1);

      expect(installed.context2dFor(first)?.names()).toEqual(["fillRect"]);
      expect(first.getContext("2d")).toBe(ctx);
      expect(installed.context2dFor(second)).toBeUndefined();
      expect(installed.glFor(first)).toBeUndefined();
    } finally {
      installed.uninstall();
    }
    expect(HTMLCanvasElement.prototype.getContext).toBe(jsdomGetContext);
  });

  it("builds a stage, a screen, and a surface that agree about their size", () => {
    const rig = createStage({ cssWidth: 400, cssHeight: 300, dpr: 3 });

    expect(rig.stage.canvas.width).toBe(1200);
    expect(rig.screen.canvas.height).toBe(900);
    expect(rig.surface.surface.cssWidth()).toBe(400);
    expect(rig.surface.surface.dpr()).toBe(3);
    expect(rig.surface.surface.origin?.()).toEqual({ x: 0, y: 0 });
  });

  it("counts what was asked of the optional half of a surface", () => {
    const rig = createStage();

    const release = rig.surface.surface.claimGestures?.();
    rig.surface.surface.capturePointer?.(7);
    release?.();
    rig.surface.surface.releasePointerCapture?.(7);

    expect(rig.surface.claims()).toBe(1);
    expect(rig.surface.releases()).toBe(1);
    expect(rig.surface.captured()).toEqual([7]);
    expect(rig.surface.releasedCaptures()).toEqual([7]);
  });
});

describe("the WebCodecs stubs", () => {
  it("are absent until installed and gone again afterwards", () => {
    expect(hasCodecs()).toBe(false);

    const codecs = installCodecs();
    expect(hasCodecs()).toBe(true);
    codecs.uninstall();

    expect(hasCodecs()).toBe(false);
    expect("VideoFrame" in globalThis).toBe(false);
  });

  it("emit a chunk per frame, keyed on the interval the test chose", async () => {
    const codecs = installCodecs({ keyframeInterval: 3, chunkBytes: 8 });
    try {
      const chunks: { type: string; timestamp: number }[] = [];
      const encoder = new (
        globalThis as unknown as {
          VideoEncoder: new (init: {
            output: (chunk: { type: string; timestamp: number }) => void;
            error: (error: Error) => void;
          }) => {
            configure: (config: unknown) => void;
            encode: (frame: unknown) => void;
            flush: () => Promise<void>;
            close: () => void;
          };
        }
      ).VideoEncoder({
        output: (chunk) => chunks.push({ ...chunk }),
        error: () => {
          throw new Error(
            "the encoder reported a failure the test did not ask for",
          );
        },
      });
      encoder.configure({ codec: "vp09.00.10.08", width: 4, height: 4 });

      const canvas = document.createElement("canvas");
      for (let at = 0; at < 4; at += 1) {
        encoder.encode(
          new (
            globalThis as unknown as {
              VideoFrame: new (
                source: unknown,
                init: { timestamp: number },
              ) => unknown;
            }
          ).VideoFrame(canvas, { timestamp: at * 16_000 }),
        );
      }
      await encoder.flush();
      encoder.close();

      expect(chunks.map((one) => one.type)).toEqual([
        "key",
        "delta",
        "delta",
        "key",
      ]);
      expect(chunks.map((one) => one.timestamp)).toEqual([
        0, 16_000, 32_000, 48_000,
      ]);
      expect(codecs.encoder()?.emitted).toHaveLength(4);
      expect(codecs.frames).toHaveLength(4);
    } finally {
      codecs.uninstall();
    }
  });

  it("hold every chunk until a flush when the test asks them to", async () => {
    const codecs = installCodecs({ manual: true, chunkBytes: 4 });
    try {
      const order: string[] = [];
      const Encoder = (
        globalThis as unknown as {
          VideoEncoder: new (init: unknown) => {
            configure: (config: unknown) => void;
            encode: (frame: unknown) => void;
            flush: () => Promise<void>;
          };
        }
      ).VideoEncoder;
      const encoder = new Encoder({
        output: (): void => {
          order.push("chunk");
        },
        error: (): void => {},
      });
      encoder.configure({ codec: "vp09.00.10.08" });
      const Frame = (
        globalThis as unknown as {
          VideoFrame: new (
            source: unknown,
            init: { timestamp: number },
          ) => unknown;
        }
      ).VideoFrame;
      encoder.encode(
        new Frame(document.createElement("canvas"), { timestamp: 0 }),
      );
      await Promise.resolve();

      expect(order).toEqual([]);

      await encoder.flush();
      order.push("flushed");

      expect(order).toEqual(["chunk", "flushed"]);
    } finally {
      codecs.uninstall();
    }
  });

  it("copy out bytes that name the frame they came from", async () => {
    const codecs = installCodecs({ chunkBytes: 4 });
    try {
      const bytes: number[][] = [];
      const Encoder = (
        globalThis as unknown as {
          VideoEncoder: new (init: unknown) => {
            configure: (config: unknown) => void;
            encode: (frame: unknown) => void;
            flush: () => Promise<void>;
          };
        }
      ).VideoEncoder;
      const encoder = new Encoder({
        output: (chunk: {
          byteLength: number;
          copyTo: (into: Uint8Array) => void;
        }): void => {
          const into = new Uint8Array(chunk.byteLength);
          chunk.copyTo(into);
          bytes.push([...into]);
        },
        error: (): void => {},
      });
      encoder.configure({ codec: "vp09.00.10.08" });
      const Frame = (
        globalThis as unknown as {
          VideoFrame: new (
            source: unknown,
            init: { timestamp: number },
          ) => unknown;
        }
      ).VideoFrame;
      const canvas = document.createElement("canvas");
      encoder.encode(new Frame(canvas, { timestamp: 0 }));
      encoder.encode(new Frame(canvas, { timestamp: 1 }));
      await encoder.flush();

      expect(bytes).toEqual([
        [0, 0, 0, 0],
        [1, 1, 1, 1],
      ]);
      expect(codecs.frames.every((frame) => frame.closed)).toBe(false);
    } finally {
      codecs.uninstall();
    }
  });

  it("refuse to encode before they are configured, as a real encoder does", () => {
    const codecs = installCodecs();
    try {
      const Encoder = (
        globalThis as unknown as {
          VideoEncoder: new (init: unknown) => {
            encode: (frame: unknown) => void;
          };
        }
      ).VideoEncoder;
      const encoder = new Encoder({
        output: (): void => {},
        error: (): void => {},
      });

      expect(() => {
        encoder.encode({ timestamp: 0 });
      }).toThrow(/unconfigured/);
    } finally {
      codecs.uninstall();
    }
  });
});
