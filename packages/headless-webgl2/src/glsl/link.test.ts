import { describe, expect, it } from "vitest";
import { GL } from "../constants";
import { compileStage, linkStages, type CheckedShader, type LinkedProgram } from "./link";

/**
 * The linker's cross-stage decisions: attribute location assignment, varying
 * matching by name and type, uniform merging, and the introspection records
 * (`LinkedAttribute`/`LinkedUniform`) the context reports through
 * `getActiveUniform`/`getActiveAttrib`. Failures are values carrying a log,
 * never throws — the shape the context's LINK_STATUS surface needs. Numeric
 * behavior of the linked functions lives in the emit suite.
 */

const V = "#version 300 es\n";
const MINIMAL_FRAGMENT = `${V}out vec4 o_color;\nvoid main() { o_color = vec4(1.0); }`;

function compiled(source: string, stage: "vertex" | "fragment"): CheckedShader {
  const result = compileStage(source, stage);
  if (!result.ok) throw new Error(`${stage}: ${result.log}`);
  return result.shader;
}

function linkOk(vertexSource: string, fragmentSource: string, bound: ReadonlyMap<string, number> = new Map()): LinkedProgram {
  const result = linkStages(compiled(vertexSource, "vertex"), compiled(fragmentSource, "fragment"), bound);
  if (!result.ok) throw new Error(result.log);
  return result.program;
}

function linkErr(vertexSource: string, fragmentSource: string, bound: ReadonlyMap<string, number> = new Map()): string {
  const result = linkStages(compiled(vertexSource, "vertex"), compiled(fragmentSource, "fragment"), bound);
  if (result.ok) throw new Error("expected the link to fail");
  return result.log;
}

/* ---------------------------------------------------------------------- */
/* Attribute locations                                                    */
/* ---------------------------------------------------------------------- */

describe("attribute location assignment", () => {
  it("honors layout(location = N) over everything else", () => {
    const program = linkOk(`${V}layout(location = 7) in vec3 a_pos;\nvoid main() { gl_Position = vec4(a_pos, 1.0); }`, MINIMAL_FRAGMENT, new Map([["a_pos", 2]]));
    expect(program.attributes).toEqual([expect.objectContaining({ name: "a_pos", location: 7, glType: GL.FLOAT_VEC3, componentCount: 3 })]);
  });

  it("honors a bindAttribLocation request where the shader says nothing", () => {
    const program = linkOk(`${V}in vec3 a_pos;\nin vec2 a_uv;\nvoid main() { gl_Position = vec4(a_pos, a_uv.x); }`, MINIMAL_FRAGMENT, new Map([["a_uv", 5]]));
    const byName = new Map(program.attributes.map((a) => [a.name, a.location]));
    expect(byName.get("a_uv")).toBe(5);
    expect(byName.get("a_pos")).toBe(0);
  });

  it("fills unlocated attributes with the lowest free locations in declaration order", () => {
    const program = linkOk(
      `${V}layout(location = 1) in vec3 a_mid;\nin vec2 a_first;\nin float a_second;\nvoid main() { gl_Position = vec4(a_mid, a_first.x + a_second); }`,
      MINIMAL_FRAGMENT,
    );
    const byName = new Map(program.attributes.map((a) => [a.name, a.location]));
    // 1 is taken by the layout qualifier, so declaration order gets 0 then 2.
    expect(byName.get("a_mid")).toBe(1);
    expect(byName.get("a_first")).toBe(0);
    expect(byName.get("a_second")).toBe(2);
  });

  it("fails when two layout qualifiers claim one location, naming both attributes", () => {
    const log = linkErr(`${V}layout(location = 3) in vec3 a_one;\nlayout(location = 3) in vec2 a_two;\nvoid main() { gl_Position = vec4(a_one, a_two.x); }`, MINIMAL_FRAGMENT);
    expect(log).toMatch(/'a_one' and 'a_two' both claim location 3/);
  });

  it("fails when a bindAttribLocation request lands on a layout-claimed location", () => {
    const log = linkErr(`${V}layout(location = 4) in vec3 a_pos;\nin vec2 a_uv;\nvoid main() { gl_Position = vec4(a_pos, a_uv.x); }`, MINIMAL_FRAGMENT, new Map([["a_uv", 4]]));
    expect(log).toMatch(/bindAttribLocation put 'a_uv' at 4, already claimed by 'a_pos'/);
  });

  it("fails when the vertex shader needs more than the 16 attribute locations", () => {
    const decls = Array.from({ length: 17 }, (_, i) => `in float a_${i};`).join("\n");
    const sum = Array.from({ length: 17 }, (_, i) => `a_${i}`).join(" + ");
    const log = linkErr(`${V}${decls}\nvoid main() { gl_Position = vec4(${sum}); }`, MINIMAL_FRAGMENT);
    expect(log).toMatch(/needs more than 16 attribute locations/);
  });
});

/* ---------------------------------------------------------------------- */
/* Varying matching                                                       */
/* ---------------------------------------------------------------------- */

describe("varying matching", () => {
  it("lays fragment inputs out first, in declaration order, so both stages agree on offsets", () => {
    const program = linkOk(
      `${V}out vec3 v_color;\nout vec2 v_uv;\nvoid main() { v_color = vec3(1.0); v_uv = vec2(0.0); gl_Position = vec4(0.0); }`,
      `${V}in vec2 v_uv;\nin vec3 v_color;\nout vec4 o_color;\nvoid main() { o_color = vec4(v_color, v_uv.x); }`,
    );
    expect(program.varyingComponents).toBe(5);
    // Cross-stage agreement is proven by running both stages over one file.
    const varyings = new Float64Array(program.varyingComponents);
    program.vertex(new Float64Array(16 * 4), new Float64Array(program.uniformSlotCount), [], varyings, new Float64Array(4));
    const out = new Float64Array(4);
    program.fragment(varyings, new Float64Array(program.uniformSlotCount), [], Float64Array.from([0, 0, 0, 1]), true, out);
    expect([...out]).toEqual([1, 1, 1, 0]);
  });

  it("gives an unread vertex output storage after the read varyings", () => {
    const program = linkOk(
      `${V}out vec3 v_used;\nout vec4 v_unread;\nvoid main() { v_used = vec3(1.0); v_unread = vec4(2.0); gl_Position = vec4(0.0); }`,
      `${V}in vec3 v_used;\nout vec4 o_color;\nvoid main() { o_color = vec4(v_used, 1.0); }`,
    );
    // 3 read components plus 4 written-but-unread ones the writer needs room for.
    expect(program.varyingComponents).toBe(7);
  });

  it("fails a fragment input with no matching vertex output, spelling the missing declaration", () => {
    const log = linkErr(`${V}void main() { gl_Position = vec4(0.0); }`, `${V}in vec3 v_normal;\nout vec4 o_color;\nvoid main() { o_color = vec4(v_normal, 1.0); }`);
    expect(log).toMatch(/fragment input 'v_normal' has no matching vertex output; declare 'out vec3 v_normal' in the vertex shader/);
  });

  it("fails a varying whose types disagree across the stages, naming both", () => {
    const log = linkErr(
      `${V}out vec2 v_uv;\nvoid main() { v_uv = vec2(0.0); gl_Position = vec4(0.0); }`,
      `${V}in vec3 v_uv;\nout vec4 o_color;\nvoid main() { o_color = vec4(v_uv, 1.0); }`,
    );
    expect(log).toMatch(/varying 'v_uv' is vec2 in the vertex shader but vec3 in the fragment shader/);
  });

  it("fails a program over the 60-component varying budget (15 vec4s)", () => {
    const outs = Array.from({ length: 16 }, (_, i) => `out vec4 v_${i};`).join("\n");
    const writes = Array.from({ length: 16 }, (_, i) => `v_${i} = vec4(0.0);`).join(" ");
    const ins = Array.from({ length: 16 }, (_, i) => `in vec4 v_${i};`).join("\n");
    const sum = Array.from({ length: 16 }, (_, i) => `v_${i}`).join(" + ");
    const log = linkErr(`${V}${outs}\nvoid main() { ${writes} gl_Position = vec4(0.0); }`, `${V}${ins}\nout vec4 o_color;\nvoid main() { o_color = ${sum}; }`);
    expect(log).toMatch(/64 varying components, over the limit of 60 \(15 vec4s\)/);
  });
});

/* ---------------------------------------------------------------------- */
/* Uniform merging and introspection                                      */
/* ---------------------------------------------------------------------- */

describe("uniform merging and introspection", () => {
  it("merges a uniform declared in both stages into one storage slot", () => {
    const program = linkOk(
      `${V}uniform mat4 u_mvp;\nuniform float u_time;\nvoid main() { gl_Position = u_mvp * vec4(u_time); }`,
      `${V}uniform float u_time;\nout vec4 o_color;\nvoid main() { o_color = vec4(u_time); }`,
    );
    expect(program.uniforms.filter((u) => u.baseName === "u_time")).toHaveLength(1);
    // One store feeds both stages: 16 mat4 slots + 1 shared float.
    expect(program.uniformSlotCount).toBe(17);
  });

  it("fails a uniform whose types disagree across the stages", () => {
    const log = linkErr(
      `${V}uniform vec3 u_tint;\nvoid main() { gl_Position = vec4(u_tint, 1.0); }`,
      `${V}uniform vec4 u_tint;\nout vec4 o_color;\nvoid main() { o_color = u_tint; }`,
    );
    expect(log).toMatch(/uniform 'u_tint' is vec3 in one stage and vec4 in the other/);
  });

  it("introspects an array uniform as name[0] with its length as size, per GL", () => {
    const program = linkOk(`${V}uniform vec4 u_lights[64];\nvoid main() { gl_Position = u_lights[0]; }`, MINIMAL_FRAGMENT);
    expect(program.uniforms).toEqual([
      expect.objectContaining({ name: "u_lights[0]", baseName: "u_lights", size: 64, slot: 0, glType: GL.FLOAT_VEC4, isSampler: false }),
    ]);
    expect(program.uniformSlotCount).toBe(256);
  });

  it("types a sampler uniform as SAMPLER_2D with the sampler flag set", () => {
    const program = linkOk(
      `${V}void main() { gl_Position = vec4(0.0); }`,
      `${V}uniform sampler2D u_map;\nout vec4 o_color;\nvoid main() { o_color = texture(u_map, vec2(0.5)); }`,
    );
    expect(program.uniforms).toEqual([expect.objectContaining({ name: "u_map", glType: GL.SAMPLER_2D, isSampler: true, size: 1 })]);
  });

  it("assigns sequential slots across mixed uniform shapes, vertex stage first", () => {
    const program = linkOk(
      `${V}uniform mat4 u_mvp;\nvoid main() { gl_Position = u_mvp * vec4(1.0); }`,
      `${V}uniform vec3 u_tint;\nuniform float u_alpha;\nout vec4 o_color;\nvoid main() { o_color = vec4(u_tint, u_alpha); }`,
    );
    const slots = new Map(program.uniforms.map((u) => [u.baseName, u.slot]));
    expect(slots.get("u_mvp")).toBe(0);
    expect(slots.get("u_tint")).toBe(16);
    expect(slots.get("u_alpha")).toBe(19);
    expect(program.uniformSlotCount).toBe(20);
  });

  it("reports scalar GL type enums through glType for the introspection surface", () => {
    const program = linkOk(
      `${V}uniform float u_f;\nuniform int u_i;\nuniform bool u_b;\nvoid main() { gl_Position = vec4(u_f, float(u_i), u_b ? 1.0 : 0.0, 1.0); }`,
      MINIMAL_FRAGMENT,
    );
    const types = new Map(program.uniforms.map((u) => [u.baseName, u.glType]));
    expect(types.get("u_f")).toBe(GL.FLOAT);
    expect(types.get("u_i")).toBe(GL.INT);
    expect(types.get("u_b")).toBe(GL.BOOL);
  });
});

/* ---------------------------------------------------------------------- */
/* Compile results                                                        */
/* ---------------------------------------------------------------------- */

describe("compileStage results", () => {
  it("returns a browser-shaped line-numbered log for a broken shader, never throwing", () => {
    const result = compileStage(`${V}out vec4 o_color;\nvoid main() {\n  o_color = missing;\n}`, "fragment");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.log).toMatch(/^ERROR: 0:4: 'missing' is not declared$/);
  });

  it("returns the checked shader with its declaration tables on success", () => {
    const result = compileStage(`${V}layout(location = 2) in vec3 a_pos;\nout vec2 v_uv;\nuniform mat4 u_mvp;\nvoid main() { v_uv = a_pos.xy; gl_Position = u_mvp * vec4(a_pos, 1.0); }`, "vertex");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.shader.ins.map((i) => i.name)).toEqual(["a_pos"]);
      expect(result.shader.ins[0]?.layoutLocation).toBe(2);
      expect(result.shader.outs.map((o) => o.name)).toEqual(["v_uv"]);
      expect(result.shader.uniforms.map((u) => u.name)).toEqual(["u_mvp"]);
    }
  });
});
