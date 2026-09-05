// Supplied with the project, plus the case's own gate over `validation/`.
//
// A deliberately small flat config: the ESLint and typescript-eslint recommended
// sets, with unused bindings allowed when they are named with a leading
// underscore (which is how the stubs in `src/game.ts` mark the arguments they do
// not use yet). Linting is not type-aware, so it runs without a TypeScript
// program and stays fast.
//
// The gate under THE CASE'S GATE below, and the constants it reads, are this
// directory's addition to the seeded copy. They are here rather than in the seed
// because here is the only place they can ever fire: a run lints the repository
// the model wrote, and that happens before the case's validator project is staged
// into it, whereas this is the tree `validation/<engine>/` is copied to
// `validation/` in, and where the case's suites are linted, typechecked and run.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Why a validator may not read the build's `src/`.
 *
 * Each suite under `validation/` decides one review point. A suite that took the
 * figure it asserts from the build's own sources would be checking the build
 * against itself: a build that walks its critter at the wrong speed passes,
 * because the number compared against is the build's wrong number too. Every
 * figure a suite asserts is the CASE's, transcribed out of `specs/` into
 * `validation/constants.ts` and imported from there.
 */
const CASE_FIGURES =
  "A validator asserts the CASE's figures, never the build's: take the figure " +
  "from `../constants` (the spec-derived `validation/constants.ts`), not from " +
  "the build's `src/`. `validation/constants.ts` is the one file that may reach " +
  "into the build, and only to re-export a value the specification leaves to it.";

const STAYS_INSIDE =
  "A validator reaches outside `validation/` only through an opening the case " +
  "allows, and this project has none: it drives the built site through a " +
  "browser and takes every figure it asserts from `validation/constants.ts`. " +
  "This import leaves the project.";

/** `import()` and `require()`, which `no-restricted-imports` does not see. */
const NO_DYNAMIC_BUILD_IMPORT = [
  {
    selector: "ImportExpression > Literal[value=/(^|\\/)src(\\/|$)/]",
    message: CASE_FIGURES,
  },
  {
    selector:
      "CallExpression[callee.name='require'] > Literal[value=/(^|\\/)src(\\/|$)/]",
    message: CASE_FIGURES,
  },
];

/**
 * What `validation/constants.ts` may not do with its one opening.
 *
 * Re-exporting the build's figure table wholesale — `export * from "../src/..."` —
 * would hand every suite in the project the build's own numbers through the one
 * file allowed to reach for them, which is the rule inverted rather than kept. A
 * value the specification genuinely leaves to the build is re-exported by name.
 */
const NAMED_RE_EXPORTS_ONLY = [
  {
    selector: "ExportAllDeclaration",
    message:
      "Re-export by name the values the specification leaves to the build " +
      '(`export { LAYOUT } from "../src/constants"`). `export *` would give ' +
      "every suite the build's whole figure table.",
  },
  {
    selector: "ImportNamespaceSpecifier, ImportDefaultSpecifier",
    message:
      "Take named bindings from the build, so what this file re-exports is " +
      "written down here rather than reached through a namespace.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "out/",
      "coverage/",
      "proof/",
      ".vendor/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Named explicitly so `eslint .` walks into the TypeScript sources as well
    // as the config files at the root.
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // ------------------------------------------------------------------------
  // THE CASE'S GATE
  //
  // `validation/<engine>/` is copied to `validation/` beside the build, and the
  // suites there decide every review point. The rule they are held to is that a
  // suite asserts the specification's figures rather than the build's, so
  // `validation/` may not reach into `src/` — and, apart from the openings named
  // below, may not reach outside itself at all.
  // ------------------------------------------------------------------------
  {
    // At any depth, in either direction: nothing under the build's `src/`. The
    // engineless project's injected page scripts are `.js`, so the gate is not
    // written in terms of the extension a suite happens to have.
    files: ["validation/**/*.ts", "validation/**/*.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: "(^|/)src(/|$)", message: CASE_FIGURES }] },
      ],
      "no-restricted-syntax": ["error", ...NO_DYNAMIC_BUILD_IMPORT],
    },
  },
  {
    // A file at the root of the project: anything opening with `../` has left it.
    files: ["validation/*.ts", "validation/*.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "(^|/)src(/|$)", message: CASE_FIGURES },
            {
              regex: "^\\.\\.(/(?!src(/|$))|$)",
              message: STAYS_INSIDE,
            },
          ],
        },
      ],
    },
  },
  {
    // A suite one directory down: `../constants` is the transcription and stays
    // inside the project, so it is a second `../` that has left it.
    files: ["validation/*/*.ts", "validation/*/*.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "(^|/)src(/|$)", message: CASE_FIGURES },
            {
              regex: "^\\.\\./\\.\\.(/(?!src(/|$))|$)",
              message: STAYS_INSIDE,
            },
          ],
        },
      ],
    },
  },
  {
    // `validation/harness.ts` injects these two into the page before the build's
    // own script runs, so they are BROWSER scripts sitting in a project whose
    // every other file is Node's. Linting them as Node code reports the page's
    // own globals as undefined; this says where they run instead. They are the
    // case's own code, held to the same rules as the rest of it.
    files: ["validation/*-init.js"],
    languageOptions: {
      globals: {
        HTMLCanvasElement: "readonly",
        btoa: "readonly",
        document: "readonly",
        requestAnimationFrame: "readonly",
        window: "readonly",
      },
    },
    rules: {
      // A recorder proxies a context method onto the real one, which is what
      // capturing `this` at the wrapper is for.
      "@typescript-eslint/no-this-alias": "off",
    },
  },
  {
    // The transcription itself: the one file that may re-export a value the
    // specification genuinely leaves to the build, by name.
    files: ["validation/constants.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": [
        "error",
        ...NO_DYNAMIC_BUILD_IMPORT,
        ...NAMED_RE_EXPORTS_ONLY,
      ],
    },
  },
);
