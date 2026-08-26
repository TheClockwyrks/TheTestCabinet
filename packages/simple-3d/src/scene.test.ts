import { describe, expect, it } from "vitest";
import type { LightState } from "./contract";
import type { Transform, Vec3 } from "./math";
import type { MeshHandle } from "./assets";
import type { SceneContext, SceneFrame } from "./scene";
import { Scene } from "./scene";
import type { FrameFigures } from "./recording";

/**
 * The scene context's own behavior: the outside-`render` gate, the retained
 * state and its copies, the producers with their bounds and refusals, and the
 * non-finite skip rule as it shows in the buffered command list. What the
 * *recorder* makes of these calls is `recording.test.ts`'s business, and what
 * the *renderer* draws from the commands is `renderer.test.ts`'s — this suite
 * reads only the frame the scene hands back.
 */

const SURFACE = { width: 640, height: 360 };

/** A fresh scene over the suite's one design envelope. */
function scene(): Scene {
  return new Scene({ width: 320, height: 180, background: "#101820" });
}

/** Runs one frame: open, render `draw` inside the gate, close with `figures`. */
function frame(
  target: Scene,
  draw: (s: SceneContext) => void,
  figures: FrameFigures = { count: 0, timeMs: 0, deltaMs: 16 },
): SceneFrame {
  target.beginFrame(SURFACE);
  target.enterRender();
  try {
    draw(target);
  } finally {
    target.exitRender();
  }
  return target.endFrame(figures);
}

/** The identity transform every draw here poses at unless it says otherwise. */
const AT: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

/** A hand-made mesh handle: enough shape for clip validation, unknown to the asset tables. */
function bareMesh(clips: readonly string[]): MeshHandle {
  return {
    path: "meshes/bare.glb",
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
    nodes: [],
    clips,
  };
}

describe("the outside-render gate", () => {
  it("refuses a state setter, a draw, a producer, and the depth clear alike before any render runs", () => {
    const s = scene();
    expect(() =>
      s.setCamera({
        position: { x: 0, y: 0, z: 10 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        fovY: 1,
        near: 0.1,
        far: 100,
      }),
    ).toThrow(Error);
    expect(() =>
      s.setCamera({
        position: { x: 0, y: 0, z: 10 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        fovY: 1,
        near: 0.1,
        far: 100,
      }),
    ).toThrow(/outside render/);
    expect(() => s.clearDepth()).toThrow(/outside render/);
    expect(() => s.drawHudRect({ x: 0, y: 0 }, { x: 1, y: 1 }, "#fff")).toThrow(
      /outside render/,
    );
    expect(() => s.createSphere(1)).toThrow(/outside render/);
  });

  it("refuses a call from a stored closure after render returned", () => {
    const s = scene();
    let stolen: SceneContext | null = null;
    frame(s, (ctx) => {
      stolen = ctx;
    });
    expect(() => stolen!.createBox({ x: 1, y: 1, z: 1 })).toThrow(
      /live only while the game's render runs/,
    );
  });

  it("refuses every call after destroy, even inside an open gate", () => {
    const s = scene();
    s.beginFrame(SURFACE);
    s.enterRender();
    s.destroy();
    expect(() => s.clearDepth()).toThrow(/outside render/);
  });
});

describe("retained state", () => {
  it("opens a fresh engine on the default camera, no lights, and the standard mode", () => {
    const s = scene();
    const first = frame(s, () => {});
    expect(first.inherited.camera.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(first.inherited.camera.fovY).toBeCloseTo(Math.PI / 3, 12);
    expect(first.inherited.lights).toEqual([]);
    expect(first.inherited.mode).toBe("standard");
  });

  it("copies the camera it is handed, so mutating the argument later changes nothing", () => {
    const s = scene();
    const camera = {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      fovY: 1,
      near: 0.1,
      far: 100,
    };
    frame(s, (ctx) => {
      ctx.setCamera(camera);
    });
    camera.position.x = 999;
    const next = frame(s, () => {});
    expect(next.inherited.camera.position.x).toBe(1);
  });

  it("replaces the light list wholesale, copies its entries, and hands the renderer at most 64", () => {
    const s = scene();
    const light: LightState = {
      type: "point",
      color: "#fff",
      intensity: 1,
      position: { x: 5, y: 0, z: 0 },
      range: 10,
    };
    const many: LightState[] = Array.from({ length: 70 }, () => ({
      ...light,
      position: { ...light.position },
    }));
    const drawn = frame(s, (ctx) => {
      ctx.setLights(many);
    });
    const setOp = drawn.commands[0];
    expect(setOp?.kind).toBe("setLights");
    if (setOp?.kind === "setLights") expect(setOp.lights).toHaveLength(64);

    (many[0] as { intensity: number }).intensity = 99;
    const next = frame(s, () => {});
    expect(next.inherited.lights).toHaveLength(64);
    expect(next.inherited.lights[0]?.intensity).toBe(1);
  });

  it("holds a set mode across frames until set again", () => {
    const s = scene();
    frame(s, (ctx) => {
      ctx.setMode("wireframe");
    });
    expect(frame(s, () => {}).inherited.mode).toBe("wireframe");
  });

  it("refuses a mode outside the vocabulary, naming every valid mode", () => {
    const s = scene();
    expect(() =>
      frame(s, (ctx) => {
        ctx.setMode("sketch" as never);
      }),
    ).toThrow(/"standard", "wireframe", "unlit", and "normals"/);
  });

  it("buffers clearDepth where it stands in the issue order", () => {
    const s = scene();
    const drawn = frame(s, (ctx) => {
      ctx.drawHudRect({ x: 0, y: 0 }, { x: 1, y: 1 }, "#fff");
      ctx.clearDepth();
    });
    expect(drawn.commands.map((c) => c.kind)).toEqual([
      "hudRect",
      "clearDepth",
    ]);
  });
});

describe("producers", () => {
  it("bounds a box at half its size on each axis", () => {
    const s = scene();
    frame(s, (ctx) => {
      const g = ctx.createBox({ x: 2, y: 4, z: 6 });
      expect(g.bounds).toEqual({
        min: { x: -1, y: -2, z: -3 },
        max: { x: 1, y: 2, z: 3 },
      });
    });
  });

  it("bounds a sphere at its radius, a cylinder at radius and half height, a plane flat on Y", () => {
    const s = scene();
    frame(s, (ctx) => {
      expect(ctx.createSphere(2).bounds.max).toEqual({ x: 2, y: 2, z: 2 });
      expect(ctx.createCylinder(1, 4).bounds).toEqual({
        min: { x: -1, y: -2, z: -1 },
        max: { x: 1, y: 2, z: 1 },
      });
      expect(ctx.createPlane(4, 6).bounds).toEqual({
        min: { x: -2, y: 0, z: -3 },
        max: { x: 2, y: 0, z: 3 },
      });
    });
  });

  it("bounds a capsule at height/2 + radius along the axis, because height spans the cap centers", () => {
    const s = scene();
    frame(s, (ctx) => {
      expect(ctx.createCapsule(1, 3).bounds).toEqual({
        min: { x: -1, y: -2.5, z: -1 },
        max: { x: 1, y: 2.5, z: 1 },
      });
    });
  });

  it("freezes a produced geometry and its bounds", () => {
    const s = scene();
    frame(s, (ctx) => {
      const g = ctx.createSphere(1);
      expect(Object.isFrozen(g)).toBe(true);
      expect(Object.isFrozen(g.bounds)).toBe(true);
      expect(Object.isFrozen(g.bounds.min)).toBe(true);
    });
  });

  it("refuses a dimension that is not finite and positive, naming the value", () => {
    const s = scene();
    frame(s, (ctx) => {
      expect(() => ctx.createSphere(0)).toThrow(RangeError);
      expect(() => ctx.createSphere(0)).toThrow(
        /radius must be finite and positive, got 0/,
      );
      expect(() => ctx.createBox({ x: 1, y: Number.NaN, z: 1 })).toThrow(
        /size\.y must be finite and positive, got NaN/,
      );
      expect(() => ctx.createCapsule(1, -2)).toThrow(
        /height must be finite and positive, got -2/,
      );
      expect(() => ctx.createCylinder(Number.POSITIVE_INFINITY, 1)).toThrow(
        RangeError,
      );
      expect(() => ctx.createPlane(1, 0)).toThrow(
        /depth must be finite and positive, got 0/,
      );
    });
  });

  it("fills a material's defaults into a frozen spec and copies the argument", () => {
    const s = scene();
    frame(s, (ctx) => {
      const spec = { baseColor: "#336699" };
      const material = ctx.createMaterial(spec);
      expect(material.spec).toEqual({
        baseColor: "#336699",
        roughness: 0.8,
        metallic: 0,
        emissive: "#000000",
        opacity: 1,
        unlit: false,
      });
      expect(Object.isFrozen(material)).toBe(true);
      expect(Object.isFrozen(material.spec)).toBe(true);
      spec.baseColor = "#ffffff";
      expect(material.spec.baseColor).toBe("#336699");
    });
  });

  it("refuses roughness, metallic, and opacity outside 0..1 or not finite, naming field and value", () => {
    const s = scene();
    frame(s, (ctx) => {
      expect(() => ctx.createMaterial({ roughness: 1.5 })).toThrow(RangeError);
      expect(() => ctx.createMaterial({ roughness: 1.5 })).toThrow(
        /roughness must be a finite number from 0 to 1, got 1.5/,
      );
      expect(() => ctx.createMaterial({ metallic: Number.NaN })).toThrow(
        /metallic .* got NaN/,
      );
      expect(() => ctx.createMaterial({ opacity: -0.1 })).toThrow(
        /opacity .* got -0.1/,
      );
      // The boundaries themselves are legal.
      expect(() =>
        ctx.createMaterial({ roughness: 0, metallic: 1, opacity: 0 }),
      ).not.toThrow();
    });
  });
});

describe("draw calls and the command list", () => {
  it("keeps issue order across the whole frame", () => {
    const s = scene();
    const drawn = frame(s, (ctx) => {
      ctx.drawHudText("HI", { x: 0, y: 0 });
      ctx.drawLine(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        "#fff",
      );
      ctx.drawGeometry(ctx.createSphere(1), "#ff0000", AT);
    });
    expect(drawn.commands.map((c) => c.kind)).toEqual([
      "hudText",
      "line",
      "geometry",
    ]);
  });

  it("resolves a color string to a standard material with the documented defaults", () => {
    const s = scene();
    const drawn = frame(s, (ctx) => {
      ctx.drawGeometry(ctx.createBox({ x: 1, y: 1, z: 1 }), "#ff8040", AT);
    });
    const command = drawn.commands[0];
    expect(command?.kind).toBe("geometry");
    if (command?.kind === "geometry") {
      expect(command.material.baseColor).toBe("#ff8040");
      expect(command.material.roughness).toBe(0.8);
      expect(command.material.opacity).toBe(1);
      expect(command.spec).toEqual({
        shape: "box",
        size: { x: 1, y: 1, z: 1 },
      });
    }
  });

  it("resolves a produced material to its filled figures", () => {
    const s = scene();
    const drawn = frame(s, (ctx) => {
      const material = ctx.createMaterial({ opacity: 0.5, unlit: true });
      ctx.drawGeometry(ctx.createPlane(1, 1), material, AT);
    });
    const command = drawn.commands[0];
    if (command?.kind === "geometry") {
      expect(command.material.opacity).toBe(0.5);
      expect(command.material.unlit).toBe(true);
    } else {
      expect.fail("expected a geometry command");
    }
  });

  it("fills the HUD text defaults: size 24, white, left-aligned", () => {
    const s = scene();
    const drawn = frame(s, (ctx) => {
      ctx.drawHudText("SCORE", { x: 10, y: 20 });
    });
    const command = drawn.commands[0];
    if (command?.kind === "hudText") {
      expect(command.size).toBe(24);
      expect(command.color).toBe("#ffffff");
      expect(command.align).toBe("left");
    } else {
      expect.fail("expected a hudText command");
    }
  });

  it("copies a transform, so mutating it after the call cannot move a buffered draw", () => {
    const s = scene();
    const moving: Transform = {
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const drawn = frame(s, (ctx) => {
      ctx.drawGeometry(ctx.createSphere(1), "#fff", moving);
      moving.position.x = 42;
    });
    const command = drawn.commands[0];
    if (command?.kind === "geometry")
      expect(command.transform.position.x).toBe(1);
    else expect.fail("expected a geometry command");
  });
});

describe("the non-finite skip rule", () => {
  it("skips a draw carrying a non-finite transform, position, size, or point, keeping its neighbours", () => {
    const s = scene();
    const nan: Vec3 = { x: Number.NaN, y: 0, z: 0 };
    const drawn = frame(s, (ctx) => {
      const g = ctx.createSphere(1);
      ctx.drawGeometry(g, "#fff", { ...AT, position: nan });
      ctx.drawBillboard({ path: "t", width: 1, height: 1 }, nan, {
        x: 1,
        y: 1,
      });
      ctx.drawHudRect(
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 1 },
        "#fff",
      );
      ctx.drawLine([{ x: 0, y: 0, z: 0 }, nan], "#fff");
      ctx.drawGeometry(g, "#fff", AT);
    });
    expect(drawn.commands.map((c) => c.kind)).toEqual(["geometry"]);
  });

  it("draws nothing for a line with fewer than two points", () => {
    const s = scene();
    const drawn = frame(s, (ctx) => {
      ctx.drawLine([{ x: 0, y: 0, z: 0 }], "#fff");
      ctx.drawLine([], "#fff");
    });
    expect(drawn.commands).toHaveLength(0);
  });
});

describe("drawMesh validation", () => {
  it("refuses a clip the mesh does not carry, listing the clips it does", () => {
    const s = scene();
    frame(s, (ctx) => {
      expect(() =>
        ctx.drawMesh(bareMesh(["walk", "idle"]), AT, { clip: "run" }),
      ).toThrow(Error);
      expect(() =>
        ctx.drawMesh(bareMesh(["walk", "idle"]), AT, { clip: "run" }),
      ).toThrow(/clip "run".*its clips are \["walk", "idle"\]/);
    });
  });

  it("accepts a clip the mesh carries and buffers the pose figures", () => {
    const s = scene();
    const drawn = frame(s, (ctx) => {
      ctx.drawMesh(bareMesh(["walk"]), AT, { clip: "walk", clipTime: 2.5 });
    });
    const command = drawn.commands[0];
    if (command?.kind === "mesh") {
      expect(command.clip).toBe("walk");
      expect(command.clipTime).toBe(2.5);
      expect(command.material).toBeNull();
    } else {
      expect.fail("expected a mesh command");
    }
  });
});
