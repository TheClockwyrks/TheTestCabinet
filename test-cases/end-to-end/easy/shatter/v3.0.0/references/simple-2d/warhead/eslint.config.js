// Supplied with the project. Do not edit.
//
// A deliberately small flat config: the ESLint and typescript-eslint recommended
// sets, with unused bindings allowed when they are named with a leading
// underscore (which is how a stub marks the arguments it does not use yet).
// Linting is not type-aware, so it runs without a TypeScript program and stays
// fast.
//
// The blocks over `validation/` are the case's own and are not part of the
// project a run is seeded: the case stages its validators into this tree at
// `validation/` (from `validation/<engine>/`), and they hold the rule that keeps
// a check honest.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Why the blocks over `validation/` exist. A check asserts the figures the
// SPECIFICATION fixes. A check that imports a figure out of the build it is
// grading asserts only that the build agrees with itself, which holds for every
// build, including one whose figure is wrong, so the check grades nothing.
const READS_THE_BUILD =
  "a validator may not read the build it grades. Import the figure from " +
  "`validation/constants.ts`, which transcribes it from the specs.";

// The narrower one, for the file that is allowed to reach the build.
const TAKES_THE_BUILD_WHOLE =
  "`validation/constants.ts` may re-export a value the specs leave to the " +
  "build, one named binding at a time. Taking a build module whole hands its " +
  "figures to every check that imports this file.";

// The rules that refuse a specifier climbing out of the staged project. `escape`
// is the pattern a specifier matches when it leaves the project from a file at a
// given depth: one `..` from the project root, two from a check in a category
// directory. Matching the climb rather than a filename covers every module of the
// build rather than `src/constants` alone. `no-restricted-imports` reads
// `export ... from` as well as `import`, which is what stops a file re-exporting
// the build's whole table to the suites around it, and the two
// `no-restricted-syntax` entries close the same door on `import()` and
// `require()`.
const refuseEscapes = (escape) => ({
  "no-restricted-imports": [
    "error",
    { patterns: [{ regex: escape, message: READS_THE_BUILD }] },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: `ImportExpression > Literal[value=/${escape}/]`,
      message: READS_THE_BUILD,
    },
    {
      selector: `CallExpression[callee.name='require'] > Literal[value=/${escape}/]`,
      message: READS_THE_BUILD,
    },
  ],
});

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "out/",
      "coverage/",
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
  {
    // `validation/audio-init.js` and `validation/recorder-init.js` are installed
    // into the page the engineless project drives, so the browser evaluates them
    // rather than the suite that installs them. The globals they read are the
    // document's, named one at a time so the set stays the set these two files
    // use, and the recorder holds the receiver of a method it is wrapping in a
    // local, which is what a wrapper written in plain browser JavaScript does.
    files: ["validation/*.js"],
    languageOptions: {
      globals: {
        HTMLCanvasElement: "readonly",
        btoa: "readonly",
        document: "readonly",
        requestAnimationFrame: "readonly",
        window: "readonly",
      },
    },
    rules: { "@typescript-eslint/no-this-alias": "off" },
  },
  {
    // The staged project's own modules — its assertions, its geometry, its
    // fixtures, its vitest setup, and the scripts the engineless project
    // installs into the page it drives. None of them may reach the build.
    files: ["validation/*.ts", "validation/*.js"],
    ignores: ["validation/constants.ts", "validation/harness.ts"],
    rules: refuseEscapes("^\\.\\.\\/"),
  },
  {
    // Every check, and the scene builders beside them, one directory down under
    // the category the review point belongs to. Two `..` leave the project.
    files: ["validation/*/*.ts", "validation/*/*.js"],
    rules: refuseEscapes("^\\.\\.\\/\\.\\.\\/"),
  },
  {
    // `validation/harness.ts` is the file that stands the build up and drives
    // it. Under an engine that means importing the build entry `../src/game`,
    // which is the module the engine is handed, and nothing else; the engineless
    // harness drives the built site in a browser and reaches for nothing at all.
    files: ["validation/harness.ts"],
    rules: refuseEscapes("^\\.\\.\\/(?!src\\/game$)"),
  },
  {
    // `validation/constants.ts` is the project's transcription of the specs, and
    // the one file that may read a build module — only to re-export a value the
    // specs genuinely leave to the build, named one at a time. Taking the module
    // whole is what is refused here: `export *`, `export * as`, a namespace
    // import and a default import each hand the build's entire figure table to
    // every file that imports this one, which is the rule undone in a single
    // line.
    files: ["validation/constants.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportAllDeclaration[source.value=/^\\.\\.\\//]",
          message: TAKES_THE_BUILD_WHOLE,
        },
        {
          selector:
            "ImportDeclaration[source.value=/^\\.\\.\\//] > ImportNamespaceSpecifier",
          message: TAKES_THE_BUILD_WHOLE,
        },
        {
          selector:
            "ImportDeclaration[source.value=/^\\.\\.\\//] > ImportDefaultSpecifier",
          message: TAKES_THE_BUILD_WHOLE,
        },
        {
          selector: "ImportExpression > Literal[value=/^\\.\\.\\//]",
          message: TAKES_THE_BUILD_WHOLE,
        },
        {
          selector:
            "CallExpression[callee.name='require'] > Literal[value=/^\\.\\.\\//]",
          message: TAKES_THE_BUILD_WHOLE,
        },
      ],
    },
  },
);
