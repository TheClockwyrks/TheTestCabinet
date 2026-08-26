# The GLSL ES 3.00 subset

`@test-cabinet/headless-webgl2` compiles a real subset of GLSL ES 3.00: any
shader inside the grammar below compiles and runs with genuine GLSL semantics,
and any construct outside it fails compilation with `COMPILE_STATUS` false and
an info log naming the construct — never a silent misreading, never a throw.
The same sources must also compile on real GPU drivers, so the subset is a
strict slice of the standard language, not a dialect.

This page is binding for the engines' shaders (`@test-cabinet/simple-3d` and
`@test-cabinet/structured-3d` keep every fixed shader inside it), and it is the
contract a compile-error log points back at: the log's `ERROR: 0:<line>:
<message>` lines carry 1-based source lines and name the rejected construct,
usually with the inside-subset alternative.

## Preamble

- The first content of every shader is `#version 300 es`. Comments and blank
  lines may precede it; nothing else may.
- No other preprocessor directive exists. `#define`, `#ifdef`, `#extension`,
  and the rest are refused by name — constants are `const` globals instead.
- `precision` declarations and `highp`/`mediump`/`lowp` qualifiers are parsed
  and ignored: all arithmetic runs in f64, which satisfies every precision a
  shader could ask for.

## Types

| Kind | Types |
| --- | --- |
| Scalars | `float`, `int`, `bool` |
| Vectors | `vec2 vec3 vec4`, `ivec2 ivec3 ivec4`, `bvec2 bvec3 bvec4` |
| Matrices | `mat3`, `mat4` (square, float, column-major) |
| Samplers | `sampler2D` |
| Arrays | `T name[N]` — **uniform declarations only**, `N` a constant positive integer (a `const int` global counts) |

The only implicit conversion is GLSL's own: `int` → `float` and `ivecN` →
`vecN`. Everything else converts through constructors (`float(i)`, `int(x)`
truncates toward zero, `vec3(v4)` is refused — flatten explicitly).

Excluded by name: `uint`/`uvec*`, `mat2` and every non-square matrix,
`sampler3D`/`samplerCube`/shadow and integer samplers, and `struct`.

## Global declarations

```glsl
layout(location = 2) in vec3 a_position;   // vertex inputs; locations 0..15
in vec2 v_uv;                              // fragment inputs (varyings)
out vec4 o_color;                          // stage outputs
uniform mat4 u_mvp;
uniform vec4 u_light_pos[64];              // arrays: uniforms only
const int MAX_LIGHTS = 64;                 // consts need constant initializers
```

- Vertex inputs and varyings are float scalars/vectors only (integer or
  matrix attributes and `flat` interpolation are outside the subset).
- The fragment shader declares **exactly one** output, and it is `vec4`
  (multiple render targets are outside the subset).
- Uniforms take no initializer — values arrive through the `uniform*` API.
  A uniform declared in both stages is one storage and must agree in type.
- Unqualified mutable globals are refused; shader-wide values are `const`.
- `layout(location = N)` is meaningful on vertex `in`s; at link time it wins
  over `bindAttribLocation`, which wins over lowest-free assignment.

## Functions

`void main()` (no parameters) plus helper functions:

```glsl
float lambert(vec3 n, vec3 l) { return max(dot(normalize(n), normalize(l)), 0.0); }
```

- Parameters pass **by value**; `in` and `const` qualifiers are accepted,
  `out`/`inout` are refused (return the value instead).
- Helpers are defined above their first call; prototypes, overloading,
  recursion, redefining a built-in, and `sampler2D` parameters are refused
  (name the sampler uniform directly in the `texture()` call).
- Helpers may read uniforms, varyings, and the stage built-ins, and may write
  the stage outputs.

## Statements

| Form | Notes |
| --- | --- |
| `T x = e, y;` | Locals; an uninitialized local is zero (the deterministic reading of GLSL's undefined). `const` locals refuse assignment. |
| `lhs = e;` and `+=` `-=` `*=` `/=` | The l-value is a variable, a swizzle with unique components, or a constant-indexed element/column. Dynamic indices on the left are outside the subset. |
| `if (b) { } else { }` | The condition is `bool`; else-if chains as usual. |
| `for (...)` | The bounded form below — the subset's only loop. |
| `return e;` / `return;` | Typed against the enclosing function. |
| `discard;` | Fragment `main` only. |
| `i++;` / `i--;` | Statements only — increment inside an expression is refused. |

`while`, `do-while`, `switch`, `break`, and `continue` are outside the subset.

### The for-loop rule

```glsl
for (int i = 0; i < u_light_count; i++) { ... }
```

Every loop is provably terminating by shape, so no runtime guard exists:

- the counter is an `int` declared in the loop header, and it cannot be
  assigned inside the body;
- the condition compares the counter (on the left) with `<`, `<=`, `>`, or
  `>=` against a **constant expression or a uniform `int` scalar**;
- the update is `i++`, `i--`, `i += k`, or `i -= k` with `k` a constant
  positive int, stepping in the direction the comparison closes.

## Expressions

- Arithmetic `+ - * /` componentwise with scalar broadcast; `*` on matrices
  is the linear-algebra product (`mat*mat`, `mat*vec`, `vec*mat`). Integer
  division and `%` truncate toward zero; use `mod()` for float wrapping.
- Comparisons `< > <= >=` on numeric scalars (use `lessThan()` and friends
  for vectors); `==`/`!=` on whole values; `&& || ^^ !` on `bool`.
- The ternary `cond ? a : b`.
- Constructors: `vec3(x)` splats, `vec4(v3, w)` flattens exactly,
  `mat3(m4)` takes the upper-left, `mat3(s)` is diagonal, matrix components
  read column-major in constructor order.
- Swizzles from one component set (`xyzw`, `rgba`, or `stpq`), 1–4
  components; with no structs in the language, `.` is always a swizzle.
- Indexing: `v[i]`, `m[col]`, `u_array[i]`. Reads may use dynamic `int`
  indices; a dynamic uniform-array index clamps into range and a dynamic
  vector/matrix index selects the nearest end when out of range — the
  deterministic readings of GLSL's undefined accesses.
- Bitwise operators are refused at the lexer, with `u` literal suffixes.

## Built-in functions

```
abs sign floor ceil fract mod min max clamp mix step smoothstep
pow exp log exp2 log2 sqrt inversesqrt
sin cos tan asin acos atan(x) atan(y, x) radians degrees
length distance dot cross normalize reflect
lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not
texture(sampler, uv) textureLod(sampler, uv, lod)
```

GLSL ES 3.00 built-ins outside this list are refused by name with their
alternative where one exists — notably `texelFetch`/`textureSize` (sample
with normalized coordinates; pass sizes as uniforms), the derivative family
`dFdx`/`dFdy`/`fwidth`, `refract`/`faceforward` (compose from `dot()`),
`round`/`trunc` (compose from `floor`/`int()`), the matrix functions
`transpose`/`inverse`/`determinant` (pass precomputed matrices as uniforms),
the hyperbolics, and the packing/bit-cast families.

## Built-in variables

| Stage | Variable | Access |
| --- | --- | --- |
| vertex | `gl_Position` | write (required output) |
| vertex | `gl_PointSize` | write; accepted and discarded — points raster 1×1 |
| fragment | `gl_FragCoord` | read (`vec4`; window x, y, z, 1/w — under the `antialias` context attribute the x and y are honest 2×2-supersample coordinates, twice the device-pixel value) |
| fragment | `gl_FrontFacing` | read (`bool`) |

`gl_FragDepth` is outside the subset; depth comes from the interpolated
position.

## Execution semantics worth knowing

- All shader arithmetic runs in IEEE-754 f64 — deterministic across
  platforms, and at least as precise as any GPU `highp`.
- `normalize()` of the zero vector is the zero vector (GLSL leaves it
  implementation-defined; this implementation pins the deterministic choice).
- `mix(x, y, a)` is computed as `x·(1−a) + y·a`, reproducing both endpoints
  exactly — what lets a flat color survive to a byte-exact pixel.
- Compilation is a snapshot: `shaderSource` after `compileShader` changes
  nothing until the next compile, and linking resets every uniform to zero.
