/**
 * The built-in function library's signatures. This module owns *what a call
 * means* — argument matching, genType shape rules, the excluded-builtin table
 * — while `emit.ts` owns how each resolved call turns into JS, because the
 * checker and the emitter both consult the signatures and neither should
 * carry the other's half.
 *
 * The set is the one the spec fixes (§4.3): the componentwise math library,
 * the geometric functions, the vector relationals, and the two texture
 * lookups. A GLSL builtin outside it — derivatives, texelFetch, the matrix
 * functions — is refused by name so an engine shader hears "outside the
 * subset", never "unknown function".
 */

import { BOOL, CompileError, FLOAT, sameType, typeName, vec } from "./ast";
import type { ScalarKind, Type } from "./ast";

/** GLSL builtins that exist in ES 3.00 but sit outside the subset, each refused with its reason. */
export const EXCLUDED_FUNCTIONS = new Map<string, string>([
  [
    "texelFetch",
    "'texelFetch' is outside the subset; sample with texture() and normalized coordinates",
  ],
  [
    "textureSize",
    "'textureSize' is outside the subset; pass the size as a uniform",
  ],
  [
    "textureProj",
    "'textureProj' is outside the subset; divide by w yourself and call texture()",
  ],
  ["textureGrad", "'textureGrad' is outside the subset"],
  ["textureOffset", "'textureOffset' is outside the subset"],
  [
    "dFdx",
    "the derivative functions (dFdx/dFdy/fwidth) are outside the subset",
  ],
  [
    "dFdy",
    "the derivative functions (dFdx/dFdy/fwidth) are outside the subset",
  ],
  [
    "fwidth",
    "the derivative functions (dFdx/dFdy/fwidth) are outside the subset",
  ],
  [
    "refract",
    "'refract' is outside the subset; compute it from dot() and the refraction formula",
  ],
  [
    "faceforward",
    "'faceforward' is outside the subset; compute it from dot() and a ternary",
  ],
  [
    "transpose",
    "'transpose' is outside the subset; build the transposed matrix by columns",
  ],
  [
    "inverse",
    "'inverse' is outside the subset; pass precomputed inverse matrices as uniforms",
  ],
  ["determinant", "'determinant' is outside the subset"],
  ["matrixCompMult", "'matrixCompMult' is outside the subset"],
  ["outerProduct", "'outerProduct' is outside the subset"],
  ["round", "'round' is outside the subset; use floor(x + 0.5)"],
  ["roundEven", "'roundEven' is outside the subset"],
  ["trunc", "'trunc' is outside the subset; use float(int(x))"],
  [
    "modf",
    "'modf' is outside the subset (it needs an out parameter, which the subset excludes)",
  ],
  ["isnan", "'isnan' is outside the subset"],
  ["isinf", "'isinf' is outside the subset"],
  ["sinh", "the hyperbolic functions are outside the subset"],
  ["cosh", "the hyperbolic functions are outside the subset"],
  ["tanh", "the hyperbolic functions are outside the subset"],
  ["asinh", "the hyperbolic functions are outside the subset"],
  ["acosh", "the hyperbolic functions are outside the subset"],
  ["atanh", "the hyperbolic functions are outside the subset"],
  ["floatBitsToInt", "the bit-cast functions are outside the subset"],
  ["floatBitsToUint", "the bit-cast functions are outside the subset"],
  ["intBitsToFloat", "the bit-cast functions are outside the subset"],
  ["uintBitsToFloat", "the bit-cast functions are outside the subset"],
  ["packSnorm2x16", "the packing functions are outside the subset"],
  ["unpackSnorm2x16", "the packing functions are outside the subset"],
  ["packUnorm2x16", "the packing functions are outside the subset"],
  ["unpackUnorm2x16", "the packing functions are outside the subset"],
  ["packHalf2x16", "the packing functions are outside the subset"],
  ["unpackHalf2x16", "the packing functions are outside the subset"],
]);

/** True when `from` is `to` or implicitly converts to it (GLSL ES 3.00 §4.1.10: int → float, ivecN → vecN). */
export function convertible(from: Type, to: Type): boolean {
  if (sameType(from, to)) return true;
  if (from.kind === "scalar" && to.kind === "scalar")
    return from.scalar === "int" && to.scalar === "float";
  if (from.kind === "vector" && to.kind === "vector") {
    return (
      from.size === to.size && from.scalar === "int" && to.scalar === "float"
    );
  }
  return false;
}

function isGen(type: Type, scalar: ScalarKind): boolean {
  return (
    (type.kind === "scalar" && type.scalar === scalar) ||
    (type.kind === "vector" && type.scalar === scalar)
  );
}

/** The float genType a value converts to, or null: float/vecN stay, int/ivecN convert. */
function asFloatGen(type: Type): Type | null {
  if (isGen(type, "float")) return type;
  if (type.kind === "scalar" && type.scalar === "int") return FLOAT;
  if (type.kind === "vector" && type.scalar === "int")
    return vec("float", type.size);
  return null;
}

function fail(line: number, name: string, args: readonly Type[]): never {
  throw new CompileError(
    line,
    `no overload of '${name}' matches (${args.map(typeName).join(", ")})`,
  );
}

/**
 * Resolves a builtin call to its return type, applying the implicit int→float
 * conversions GLSL ES 3.00 grants. Returns null when `name` is not a builtin
 * (the caller then tries user functions); throws a named CompileError for an
 * excluded builtin or a signature mismatch.
 */
export function resolveBuiltin(
  name: string,
  args: readonly Type[],
  line: number,
): Type | null {
  const excluded = EXCLUDED_FUNCTIONS.get(name);
  if (excluded !== undefined) throw new CompileError(line, excluded);

  const a = args[0];
  const b = args[1];
  const c = args[2];

  switch (name) {
    /* -- componentwise, one argument -------------------------------- */
    case "abs":
    case "sign": {
      if (args.length !== 1 || a === undefined) fail(line, name, args);
      if (isGen(a, "float") || isGen(a, "int")) return a;
      const gen = asFloatGen(a);
      if (gen !== null) return gen;
      fail(line, name, args);
      break;
    }
    case "floor":
    case "ceil":
    case "fract":
    case "sqrt":
    case "inversesqrt":
    case "exp":
    case "log":
    case "exp2":
    case "log2":
    case "sin":
    case "cos":
    case "tan":
    case "asin":
    case "acos":
    case "radians":
    case "degrees":
    case "normalize": {
      if (args.length !== 1 || a === undefined) fail(line, name, args);
      const gen = asFloatGen(a);
      if (gen === null) fail(line, name, args);
      return gen;
    }
    case "atan": {
      // Both forms: atan(y_over_x) and atan(y, x).
      if (args.length === 1 && a !== undefined) {
        const gen = asFloatGen(a);
        if (gen === null) fail(line, name, args);
        return gen;
      }
      if (args.length === 2 && a !== undefined && b !== undefined) {
        const ga = asFloatGen(a);
        const gb = asFloatGen(b);
        if (ga === null || gb === null || !sameType(ga, gb))
          fail(line, name, args);
        return ga;
      }
      fail(line, name, args);
      break;
    }

    /* -- componentwise, two arguments ------------------------------- */
    case "mod": {
      // mod(genT, genT) and mod(genT, float); float-only (int uses %).
      if (args.length !== 2 || a === undefined || b === undefined)
        fail(line, name, args);
      const ga = asFloatGen(a);
      const gb = asFloatGen(b);
      if (ga === null || gb === null) fail(line, name, args);
      if (sameType(ga, gb) || gb.kind === "scalar") return ga;
      fail(line, name, args);
      break;
    }
    case "min":
    case "max": {
      if (args.length !== 2 || a === undefined || b === undefined)
        fail(line, name, args);
      // Int overloads survive only when both sides are int-shaped.
      if (
        isGen(a, "int") &&
        isGen(b, "int") &&
        (sameType(a, b) || b.kind === "scalar")
      )
        return a;
      const ga = asFloatGen(a);
      const gb = asFloatGen(b);
      if (ga === null || gb === null) fail(line, name, args);
      if (sameType(ga, gb) || gb.kind === "scalar") return ga;
      fail(line, name, args);
      break;
    }
    case "pow":
    case "reflect": {
      if (args.length !== 2 || a === undefined || b === undefined)
        fail(line, name, args);
      const ga = asFloatGen(a);
      const gb = asFloatGen(b);
      if (ga === null || gb === null || !sameType(ga, gb))
        fail(line, name, args);
      return ga;
    }
    case "step": {
      // step(edge, x): the EDGE may be scalar, broadcast over x.
      if (args.length !== 2 || a === undefined || b === undefined)
        fail(line, name, args);
      const ga = asFloatGen(a);
      const gb = asFloatGen(b);
      if (ga === null || gb === null) fail(line, name, args);
      if (sameType(ga, gb) || ga.kind === "scalar") return gb;
      fail(line, name, args);
      break;
    }

    /* -- componentwise, three arguments ----------------------------- */
    case "clamp": {
      if (
        args.length !== 3 ||
        a === undefined ||
        b === undefined ||
        c === undefined
      )
        fail(line, name, args);
      if (
        isGen(a, "int") &&
        isGen(b, "int") &&
        isGen(c, "int") &&
        sameType(b, c) &&
        (sameType(a, b) || b.kind === "scalar")
      )
        return a;
      const ga = asFloatGen(a);
      const gb = asFloatGen(b);
      const gc = asFloatGen(c);
      if (ga === null || gb === null || gc === null || !sameType(gb, gc))
        fail(line, name, args);
      if (sameType(ga, gb) || gb.kind === "scalar") return ga;
      fail(line, name, args);
      break;
    }
    case "mix": {
      if (
        args.length !== 3 ||
        a === undefined ||
        b === undefined ||
        c === undefined
      )
        fail(line, name, args);
      const ga = asFloatGen(a);
      const gb = asFloatGen(b);
      const gc = asFloatGen(c);
      if (ga === null || gb === null || gc === null || !sameType(ga, gb))
        fail(line, name, args);
      if (sameType(gc, ga) || gc.kind === "scalar") return ga;
      fail(line, name, args);
      break;
    }
    case "smoothstep": {
      // smoothstep(e0, e1, x): the edges may be scalar, broadcast over x.
      if (
        args.length !== 3 ||
        a === undefined ||
        b === undefined ||
        c === undefined
      )
        fail(line, name, args);
      const ga = asFloatGen(a);
      const gb = asFloatGen(b);
      const gc = asFloatGen(c);
      if (ga === null || gb === null || gc === null || !sameType(ga, gb))
        fail(line, name, args);
      if (sameType(ga, gc) || ga.kind === "scalar") return gc;
      fail(line, name, args);
      break;
    }

    /* -- geometric -------------------------------------------------- */
    case "length": {
      if (args.length !== 1 || a === undefined || asFloatGen(a) === null)
        fail(line, name, args);
      return FLOAT;
    }
    case "distance":
    case "dot": {
      if (args.length !== 2 || a === undefined || b === undefined)
        fail(line, name, args);
      const ga = asFloatGen(a);
      const gb = asFloatGen(b);
      if (ga === null || gb === null || !sameType(ga, gb))
        fail(line, name, args);
      return FLOAT;
    }
    case "cross": {
      const v3 = vec("float", 3);
      if (
        args.length !== 2 ||
        a === undefined ||
        b === undefined ||
        !convertible(a, v3) ||
        !convertible(b, v3)
      )
        fail(line, name, args);
      return v3;
    }

    /* -- vector relationals ----------------------------------------- */
    case "lessThan":
    case "lessThanEqual":
    case "greaterThan":
    case "greaterThanEqual": {
      if (args.length !== 2 || a === undefined || b === undefined)
        fail(line, name, args);
      if (
        a.kind !== "vector" ||
        b.kind !== "vector" ||
        a.size !== b.size ||
        a.scalar === "bool" ||
        a.scalar !== b.scalar
      )
        fail(line, name, args);
      return vec("bool", a.size);
    }
    case "equal":
    case "notEqual": {
      if (args.length !== 2 || a === undefined || b === undefined)
        fail(line, name, args);
      if (
        a.kind !== "vector" ||
        b.kind !== "vector" ||
        a.size !== b.size ||
        a.scalar !== b.scalar
      )
        fail(line, name, args);
      return vec("bool", a.size);
    }
    case "any":
    case "all": {
      if (
        args.length !== 1 ||
        a === undefined ||
        a.kind !== "vector" ||
        a.scalar !== "bool"
      )
        fail(line, name, args);
      return BOOL;
    }
    case "not": {
      if (
        args.length !== 1 ||
        a === undefined ||
        a.kind !== "vector" ||
        a.scalar !== "bool"
      )
        fail(line, name, args);
      return a;
    }

    /* -- texture lookups -------------------------------------------- */
    // The sampler argument's shape (a sampler uniform, named directly) is the
    // checker's job; the types alone are matched here.
    case "texture": {
      if (
        args.length !== 2 ||
        a?.kind !== "sampler2D" ||
        b === undefined ||
        !convertible(b, vec("float", 2))
      )
        fail(line, name, args);
      return vec("float", 4);
    }
    case "textureLod": {
      if (
        args.length !== 3 ||
        a?.kind !== "sampler2D" ||
        b === undefined ||
        !convertible(b, vec("float", 2)) ||
        c === undefined ||
        !convertible(c, FLOAT)
      )
        fail(line, name, args);
      return vec("float", 4);
    }

    default:
      return null;
  }
}
