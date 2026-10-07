// Supplied with the project. Do not edit.
//
// A deliberately small flat config: the ESLint and typescript-eslint recommended
// sets, with unused bindings allowed when they are named with a leading
// underscore, which is the convention for an argument a function accepts but
// does not use. Linting is not type-aware, so it runs without a TypeScript
// program and stays fast.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "out/",
      "coverage/",
      "showcase/",
      "specs/",
      "assets/",
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
  // `validation/` is not part of this build. It is a separate vitest project,
  // staged in beside `src/` when the finished repository is checked against the
  // specification and absent the rest of the time — so the three blocks below
  // match nothing, and cost nothing, until it is there.
  //
  // Every figure one of those suites asserts is transcribed from the
  // specification into `validation/constants.ts` and imported from
  // `../constants`. A suite that read the figure back out of `src/` would be
  // asserting only that the build agrees with itself — a walk speed of 66 where
  // the specification says 60 passes, because both sides of the comparison came
  // from the same wrong number. So nothing under `validation/` may reach into
  // `src/`.
  {
    files: ["validation/**/*.ts"],
    // `constants.ts` is the one file allowed to reach into the build, and only
    // for a value the specification genuinely leaves to the build to pick.
    ignores: ["validation/constants.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/src/*", "**/src/*/**"],
              message:
                "A validator asserts the specification's figures, not the build's. Transcribe the figure into validation/constants.ts and import it from ../constants.",
            },
          ],
        },
      ],
    },
  },
  {
    // `harness.ts` stands the build up in order to drive it, so it alone names
    // the build's entry module — and nothing else under `src/`.
    files: ["validation/harness.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/src/*", "**/src/*/**", "!../src/game"],
              message:
                "Only the build's entry module may be named here, and only to stand the build up. A figure belongs in validation/constants.ts.",
            },
          ],
        },
      ],
    },
  },
  {
    // The same reach, taken in a form an import clause does not carry. The first
    // two close the door `no-restricted-imports` cannot see through at all; the
    // last three close it on `constants.ts` too, since handing over a whole
    // module rather than named values would put the build's own figure table
    // behind every `../constants` in the project — which is the one thing the
    // exemption above is not for.
    files: ["validation/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression > Literal[value=/(^|\\/)src\\//]",
          message:
            "A validator may not load a build module dynamically to get at a figure. Transcribe it into validation/constants.ts.",
        },
        {
          selector:
            "CallExpression[callee.name='require'] > Literal[value=/(^|\\/)src\\//]",
          message:
            "A validator may not require a build module to get at a figure. Transcribe it into validation/constants.ts.",
        },
        {
          selector: "ExportAllDeclaration[source.value=/(^|\\/)src\\//]",
          message:
            "Re-exporting a build module wholesale hands its whole figure table to every suite in the project. Name each value instead.",
        },
        {
          selector:
            "ImportDeclaration[source.value=/(^|\\/)src\\//] > ImportNamespaceSpecifier",
          message:
            "Import the named values a build module is genuinely relied on for, not the module.",
        },
        {
          selector:
            "ImportDeclaration[source.value=/(^|\\/)src\\//] > ImportDefaultSpecifier",
          message:
            "Import the named values a build module is genuinely relied on for, not the module.",
        },
      ],
    },
  },
);
