import { describe, expect, it } from "vitest";
import { CompileError } from "./ast";
import { checkShader, type Stage } from "./check";

/**
 * The semantic checker's refusal table and its typing rules — everything a
 * parser cannot see: type mismatches, l-value legality, the loop-bound rule,
 * sampler containment, stage-specific built-ins. Numeric behavior of what the
 * checker accepts lives in the eval suite; cross-stage rules in the link
 * suite.
 */

const V = "#version 300 es\n";

/** A minimal valid body wrapper so table entries can focus on one construct. */
function checkErr(source: string, stage: Stage = "fragment"): string {
  const prologue = stage === "fragment" ? "out vec4 o_color;\n" : "";
  try {
    checkShader(`${V}${prologue}${source}`, stage);
  } catch (error) {
    if (error instanceof CompileError) return error.message;
    throw error;
  }
  throw new Error("expected the shader to fail checking");
}

function accepts(source: string, stage: Stage = "fragment"): void {
  const prologue = stage === "fragment" ? "out vec4 o_color;\n" : "";
  checkShader(`${V}${prologue}${source}`, stage);
}

describe("the semantic refusal table", () => {
  const table: [
    construct: string,
    source: string,
    message: RegExp,
    stage?: Stage,
  ][] = [
    // -- arrays anywhere but uniforms ----------------------------------
    [
      "a const array",
      "const float XS[3] = 1.0; void main() { o_color = vec4(1.0); }",
      /only uniform declarations may be arrays/,
    ],
    [
      "an in array",
      "in vec2 v_uv[2]; void main() { o_color = vec4(1.0); }",
      /only uniform declarations may be arrays/,
    ],
    [
      "a sampler array",
      "uniform sampler2D u_maps[4]; void main() { o_color = vec4(1.0); }",
      /sampler arrays are outside the subset/,
    ],
    [
      "a non-constant array size",
      "uniform int u_n; uniform vec4 u_xs[u_n]; void main() { o_color = vec4(1.0); }",
      /array size of 'u_xs' must be a constant positive integer/,
    ],
    [
      "a zero array size",
      "uniform vec4 u_xs[0]; void main() { o_color = vec4(1.0); }",
      /must be a constant positive integer/,
    ],

    // -- samplers stay inside texture() --------------------------------
    [
      "a sampler read outside texture()",
      "uniform sampler2D u_map; void main() { o_color = vec4(1.0); float x = u_map; }",
      /can only appear as the sampler argument of texture\(\)/,
    ],
    [
      "a sampler local",
      "void main() { sampler2D s; o_color = vec4(1.0); }",
      /sampler2D can only be declared as a uniform/,
    ],
    [
      "texture() over a non-name",
      "uniform sampler2D u_map; void main() { o_color = texture(0.5, vec2(0.5)); }",
      /must name a sampler2D uniform directly/,
    ],
    [
      "texture() over a non-sampler",
      "uniform vec2 u_uv; void main() { o_color = texture(u_uv, vec2(0.5)); }",
      /'u_uv' is not a sampler2D uniform/,
    ],

    // -- excluded builtins, by name ------------------------------------
    [
      "texelFetch",
      "uniform sampler2D u_map; void main() { o_color = texelFetch(u_map, ivec2(0), 0); }",
      /'texelFetch' is outside the subset/,
    ],
    [
      "dFdx",
      "in vec2 v_uv; void main() { o_color = vec4(dFdx(v_uv.x)); }",
      /derivative functions.*outside the subset/,
    ],
    [
      "refract",
      "void main() { o_color = vec4(refract(vec3(1.0), vec3(0.0, 1.0, 0.0), 0.5), 1.0); }",
      /'refract' is outside the subset/,
    ],
    [
      "round",
      "void main() { o_color = vec4(round(0.5)); }",
      /'round' is outside the subset; use floor\(x \+ 0\.5\)/,
    ],
    [
      "transpose",
      "uniform mat3 u_m; void main() { o_color = vec4(transpose(u_m)[0], 1.0); }",
      /'transpose' is outside the subset/,
    ],
    [
      "an unknown function",
      "void main() { o_color = vec4(shade(1.0)); }",
      /unknown function 'shade' \(helper functions must be defined above their first call\)/,
    ],

    // -- functions ------------------------------------------------------
    [
      "recursion",
      "float f(float x) { return f(x); } void main() { o_color = vec4(f(1.0)); }",
      /'f' calls itself; recursion is outside the subset/,
    ],
    [
      "redefining a function",
      "float f(float x) { return x; } float f(vec2 x) { return x.x; } void main() { o_color = vec4(1.0); }",
      /'f' is already defined \(overloading is outside the subset\)/,
    ],
    [
      "redefining a builtin",
      "float mix(float a) { return a; } void main() { o_color = vec4(1.0); }",
      /'mix' redefines a built-in function/,
    ],
    [
      "a sampler parameter",
      "float f(sampler2D s) { return 1.0; } void main() { o_color = vec4(1.0); }",
      /sampler parameter 's' is outside the subset/,
    ],
    [
      "a wrong argument count",
      "float f(float x) { return x; } void main() { o_color = vec4(f(1.0, 2.0)); }",
      /'f' takes 1 argument\(s\), got 2/,
    ],
    [
      "a wrong argument type",
      "float f(vec3 x) { return x.x; } void main() { o_color = vec4(f(1.0)); }",
      /argument 1 of 'f' must be vec3, got float/,
    ],
    [
      "a missing main",
      "float f() { return 1.0; }",
      /the fragment shader has no 'void main\(\)'/,
    ],
    [
      "main with parameters",
      "void main(float x) {}",
      /main must be declared 'void main\(\)' with no parameters/,
    ],
    [
      "a value return from void",
      "void f() { return 1.0; } void main() { o_color = vec4(1.0); }",
      /'f' is void and cannot return a value/,
    ],
    [
      "a bare return from a valued function",
      "float f() { return; } void main() { o_color = vec4(1.0); }",
      /'f' returns float; a bare return is not enough/,
    ],
    [
      "a wrong return type",
      "float f() { return vec2(1.0); } void main() { o_color = vec4(1.0); }",
      /'f' returns float, got vec2/,
    ],

    // -- discard --------------------------------------------------------
    [
      "discard in a vertex shader",
      "void main() { discard; }",
      /'discard' is only available in the fragment shader/,
      "vertex",
    ],
    [
      "discard in a helper",
      "void f() { discard; } void main() { o_color = vec4(1.0); }",
      /'discard' outside main is outside the subset/,
    ],

    // -- gl_* -----------------------------------------------------------
    [
      "gl_FragDepth",
      "void main() { gl_FragDepth = 0.5; o_color = vec4(1.0); }",
      /'gl_FragDepth' is outside the subset/,
    ],
    [
      "gl_FragCoord in a vertex shader",
      "void main() { gl_Position = gl_FragCoord; }",
      /'gl_FragCoord' does not exist in the vertex shader/,
      "vertex",
    ],
    [
      "gl_Position in a fragment shader",
      "void main() { o_color = gl_Position; }",
      /'gl_Position' does not exist in the fragment shader/,
    ],
    [
      "an unknown gl_ name",
      "void main() { o_color = vec4(gl_Whatever); }",
      /built-in 'gl_Whatever' is outside the subset/,
    ],

    // -- outputs and varyings ------------------------------------------
    [
      "a second fragment output",
      "out vec4 o_second; void main() { o_color = vec4(1.0); }",
      /second fragment output is outside the subset \(multiple render targets\)/,
    ],
    [
      "a non-vec4 fragment output",
      "void main() {}",
      /fragment output 'o_bad' must be vec4, got vec3/,
    ],
    [
      "an int varying",
      "out ivec2 v_cell; void main() { gl_Position = vec4(0.0); }",
      /varying 'v_cell' must be a float scalar or vector.*flat interpolation, which is outside the subset/,
      "vertex",
    ],
    [
      "a matrix varying",
      "out mat3 v_tbn; void main() { gl_Position = vec4(0.0); }",
      /varying 'v_tbn' must be a float scalar or vector/,
      "vertex",
    ],
    [
      "an int attribute",
      "in ivec3 a_cell; void main() { gl_Position = vec4(0.0); }",
      /vertex input 'a_cell' must be a float scalar or vector.*integer and matrix attributes are outside the subset/,
      "vertex",
    ],
    [
      "a matrix attribute",
      "in mat4 a_model; void main() { gl_Position = vec4(0.0); }",
      /vertex input 'a_model' must be a float scalar or vector/,
      "vertex",
    ],
    [
      "an out-of-range attribute location",
      "layout(location = 16) in vec3 a_pos; void main() { gl_Position = vec4(0.0); }",
      /layout\(location = 16\) on 'a_pos' is out of range; locations run 0\.\.15/,
      "vertex",
    ],
    [
      "a uniform initializer",
      "uniform float u_x = 1.0; void main() { o_color = vec4(1.0); }",
      /uniform 'u_x' cannot have an initializer; set it with the uniform\* API/,
    ],

    // -- assignment and l-values ---------------------------------------
    [
      "assigning a uniform",
      "uniform float u_x; void main() { u_x = 1.0; o_color = vec4(1.0); }",
      /'u_x' is a uniform and cannot be assigned/,
    ],
    [
      "assigning an input",
      "in vec2 v_uv; void main() { v_uv = vec2(0.0); o_color = vec4(1.0); }",
      /'v_uv' is a shader input and cannot be assigned/,
    ],
    [
      "assigning a const",
      "const float PI = 3.0; void main() { PI = 4.0; o_color = vec4(1.0); }",
      /'PI' is a const and cannot be assigned/,
    ],
    [
      "a repeated swizzle l-value",
      "void main() { vec3 v = vec3(0.0); v.xx = vec2(1.0); o_color = vec4(1.0); }",
      /'.xx' repeats a component and cannot be assigned/,
    ],
    [
      "a dynamic l-value index",
      "uniform int u_i; void main() { vec3 v = vec3(0.0); v[u_i] = 1.0; o_color = vec4(1.0); }",
      /assigning through a dynamic index is outside the subset/,
    ],
    [
      "assigning to a call",
      "float f() { return 1.0; } void main() { f() = 1.0; o_color = vec4(1.0); }",
      /left side of an assignment must be a variable, a swizzle, or a constant-indexed element/,
    ],
    [
      "a type-changing compound assignment",
      "void main() { vec3 v = vec3(1.0); mat3 m = mat3(1.0); m *= v; o_color = vec4(1.0); }",
      /'\*=' would change the type: mat3 \* vec3 is vec3/,
    ],

    // -- typing ---------------------------------------------------------
    [
      "assigning float to int",
      "void main() { int i = 1.5; o_color = vec4(1.0); }",
      /cannot initialize int 'i' from float; use int\(x\) to truncate/,
    ],
    [
      "mismatched vector sizes",
      "void main() { vec3 v = vec3(1.0) + vec2(1.0); o_color = vec4(1.0); }",
      /'\+' cannot combine vec3 and vec2/,
    ],
    [
      "comparing vectors with <",
      "void main() { bool b = vec2(1.0) < vec2(2.0); o_color = vec4(1.0); }",
      /'<' compares numeric scalars.*use lessThan\(\)\/greaterThan\(\) for vectors/,
    ],
    [
      "% on floats",
      "void main() { float x = 5.0 % 2.0; o_color = vec4(1.0); }",
      /'%' applies to int operands.*use mod\(\) for floats/,
    ],
    [
      "&& on numbers",
      "void main() { bool b = 1.0 && 2.0; o_color = vec4(1.0); }",
      /'&&' needs bool operands/,
    ],
    [
      "! on a number",
      "void main() { bool b = !1.0; o_color = vec4(1.0); }",
      /'!' needs a bool, got float \(use not\(\) for bool vectors\)/,
    ],
    [
      "a non-bool if condition",
      "void main() { if (1.0) {} o_color = vec4(1.0); }",
      /if condition must be bool, got float/,
    ],
    [
      "disagreeing ternary branches",
      "void main() { float x = true ? 1.0 : vec2(1.0); o_color = vec4(1.0); }",
      /\?: branches disagree: float vs vec2/,
    ],
    [
      "a swizzle on a scalar",
      "void main() { float x = 1.0; float y = x.x; o_color = vec4(1.0); }",
      /'.x' needs a vector, got float \(the subset has no structs/,
    ],
    [
      "a swizzle out of range",
      "void main() { vec2 v = vec2(1.0); float z = v.z; o_color = vec4(1.0); }",
      /reaches component 'z', which vec2 does not have/,
    ],
    [
      "a mixed swizzle",
      "void main() { vec4 v = vec4(1.0); vec2 w = v.xg; o_color = vec4(1.0); }",
      /mixes component sets; use only one of xyzw, rgba, stpq/,
    ],
    [
      "an out-of-range constant index",
      "void main() { vec3 v = vec3(1.0); float x = v[3]; o_color = vec4(1.0); }",
      /index 3 is out of range for vec3/,
    ],
    [
      "an out-of-range array index",
      "uniform vec4 u_xs[4]; void main() { o_color = u_xs[4]; }",
      /index 4 is out of range for vec4\[4\]/,
    ],
    [
      "indexing a scalar",
      "void main() { float x = 1.0; float y = x[0]; o_color = vec4(1.0); }",
      /float cannot be indexed/,
    ],
    [
      "a bare array read",
      "uniform vec4 u_xs[4]; void main() { o_color = u_xs; }",
      /uniform array 'u_xs' must be indexed/,
    ],
    [
      "an undeclared name",
      "void main() { o_color = vec4(missing); }",
      /'missing' is not declared/,
    ],
    [
      "a redeclaration in one scope",
      "void main() { float x = 1.0; float x = 2.0; o_color = vec4(1.0); }",
      /'x' is already declared in this scope/,
    ],
    [
      "a wrong constructor arity",
      "void main() { vec3 v = vec3(1.0, 2.0); o_color = vec4(1.0); }",
      /vec3 constructor needs exactly 3 components, got 2/,
    ],
    [
      "a matrix in a vector constructor",
      "void main() { mat3 m = mat3(1.0); vec4 v = vec4(m.length); o_color = vec4(1.0); }",
      /'.length' needs a vector, got mat3/,
    ],
    [
      "a bad builtin overload",
      "void main() { float x = dot(vec3(1.0), vec2(1.0)); o_color = vec4(1.0); }",
      /no overload of 'dot' matches \(vec3, vec2\)/,
    ],
    [
      "a const with a non-constant initializer",
      "uniform float u_x; const float K = u_x; void main() { o_color = vec4(1.0); }",
      /initializer of const 'K' must be a constant expression/,
    ],

    // -- the loop-bound rule -------------------------------------------
    [
      "a local-variable loop bound",
      "void main() { int n = 4; for (int i = 0; i < n; i++) {} o_color = vec4(1.0); }",
      /bound must be a constant expression or a uniform int scalar.*could not be proven to terminate/,
    ],
    [
      "a float loop counter",
      "void main() { for (float i = 0.0; i < 4.0; i++) {} o_color = vec4(1.0); }",
      /must declare its own int counter/,
    ],
    [
      "assigning the counter in the body",
      "void main() { for (int i = 0; i < 4; i++) { i = 0; } o_color = vec4(1.0); }",
      /counter 'i' cannot be assigned inside the loop; the fixed step is what makes the loop provably bounded/,
    ],
    [
      "a direction mismatch",
      "void main() { for (int i = 4; i > 0; i++) {} o_color = vec4(1.0); }",
      /loop steps up but its condition uses '>'; the loop would never terminate/,
    ],
    [
      "a downward mismatch",
      "void main() { for (int i = 0; i < 4; i--) {} o_color = vec4(1.0); }",
      /loop steps down but its condition uses '<'/,
    ],
    [
      "a non-constant step",
      "uniform int u_s; void main() { for (int i = 0; i < 4; i += u_s) {} o_color = vec4(1.0); }",
      /step must be a constant positive int/,
    ],
    [
      "a counter not on the left",
      "void main() { for (int i = 0; 4 > i; i++) {} o_color = vec4(1.0); }",
      /condition must have the counter 'i' on the left/,
    ],
  ];

  for (const [construct, source, message, stage] of table) {
    it(`refuses ${construct} by name`, () => {
      if (construct === "a non-vec4 fragment output") {
        // Needs its own prologue: the default vec4 out would mask the case.
        expect(() =>
          checkShader(`${V}out vec3 o_bad;\nvoid main() {}`, "fragment"),
        ).toThrow(message);
        return;
      }
      expect(checkErr(source, stage)).toMatch(message);
    });
  }

  it("requires the fragment shader to declare its color output", () => {
    expect(() => checkShader(`${V}void main() {}`, "fragment")).toThrow(
      /must declare exactly one 'out vec4' color output/,
    );
  });
});

describe("shapes the checker accepts", () => {
  it("accepts the canonical lighting-loop shader shape (uniform arrays, bounded loop, helpers)", () => {
    accepts(`
      uniform vec4 u_light_pos[64];
      uniform vec4 u_light_color[64];
      uniform int u_light_count;
      uniform sampler2D u_base_map;
      in vec3 v_normal;
      in vec2 v_uv;
      float lambert(vec3 n, vec3 l) { return max(dot(normalize(n), normalize(l)), 0.0); }
      void main() {
        vec3 lit = vec3(0.0);
        for (int i = 0; i < u_light_count; i++) {
          lit += u_light_color[i].rgb * lambert(v_normal, u_light_pos[i].xyz);
        }
        vec4 base = texture(u_base_map, v_uv);
        if (base.a < 0.01) discard;
        o_color = vec4(base.rgb * lit, base.a);
      }
    `);
  });

  it("accepts int-to-float implicit conversion in initializers, arguments, and arithmetic", () => {
    accepts(`
      float f(float x) { return x * 2; }
      void main() {
        float a = 1;
        vec2 b = vec2(1, 2) + 1;
        o_color = vec4(a, b, f(3));
      }
    `);
  });

  it("accepts const globals as array sizes and loop bounds", () => {
    accepts(`
      const int N = 4;
      uniform vec4 u_xs[N];
      void main() {
        vec4 sum = vec4(0.0);
        for (int i = 0; i < N; i++) { sum += u_xs[i]; }
        o_color = sum;
      }
    `);
  });

  it("accepts shadowing in a nested scope while refusing it in the same scope", () => {
    accepts(
      "void main() { float x = 1.0; { float x = 2.0; } o_color = vec4(x); }",
    );
  });

  it("accepts == and != on whole vectors and matrices", () => {
    accepts(
      "void main() { bool a = vec3(1.0) == vec3(1.0); bool b = mat3(1.0) != mat3(2.0); o_color = vec4(a == b); }",
    );
  });
});
