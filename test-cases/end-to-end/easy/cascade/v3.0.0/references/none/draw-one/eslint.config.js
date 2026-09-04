// Supplied with the project, plus the case's own validator gate at the bottom.
//
// A deliberately small flat config: the ESLint and typescript-eslint recommended
// sets, with unused bindings allowed when they are named with a leading
// underscore. Linting is not type-aware, so it runs without a TypeScript
// program and stays fast.
//
// THIS COPY IS THE REFERENCE WORKSPACE'S, NOT THE SEEDED ONE. It carries five
// blocks the seeded `workspaces/**/eslint.config.js` does not, all of them about
// `validation/` — the case's validator project, staged in beside the build by
// hand the same way `.gitignore` describes. A run never sees them: `validation/`
// is not seeded, and the four checks `specs/overview.md` names run over the
// repository before the validator is staged into it. They exist so that an
// AUTHOR who stages the suite and runs `npm run lint` is held to the rules the
// suite is written under.

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
      ".tcab/",
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

  // ---------------------------------------------------------------------------
  // The validator gate. `validation/<engine>/` is copied to `<repo>/validation/`
  // to run the suite, so under this root the staged names are
  // `validation/constants.ts` and `validation/harness.ts`.
  //
  // WHY. A validator decides whether the build matches the SPECIFICATION. A
  // suite that imports the figure it asserts from the build's own `src/` asserts
  // nothing: the check collapses to "does the build agree with itself", and a
  // build walking the wrong number passes a clean sheet. So every figure a suite
  // asserts is transcribed from `specs/` into `validation/constants.ts`, and
  // that file is the only one allowed to reach into the build for a figure — and
  // only for a value the specification genuinely leaves to the build. The one
  // other exemption is `validation/harness.ts` in the block after this, which
  // takes the build's ENTRY rather than any figure.
  //
  // A type carries no figure, so a type-only clause is allowed anywhere.
  // ---------------------------------------------------------------------------
  {
    files: ["validation/**/*.ts", "validation/**/*.js"],
    ignores: ["validation/constants.ts", "validation/harness.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/src", "**/src/*", "**/src/**"],
              allowTypeImports: true,
              message:
                "A validator may not read a figure out of the build it is judging. Import it from `../constants`, which transcribes it from `specs/`.",
            },
          ],
        },
      ],
    },
  },
  {
    // `validation/harness.ts` is the one driver: it stands the build up, so it
    // takes the build's ENTRY — `../src/game`, the module `specs/overview.md`
    // fixes — and nothing else under `src/`. Every figure it hands the suites
    // still comes from `../constants`. (Under `none` the harness drives the
    // built site in a browser and imports no build module at all.)
    files: ["validation/harness.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "../src",
              message:
                "The harness stands the build up through its entry, `../src/game`.",
            },
          ],
          patterns: [
            {
              // Gitignore-style, so the negation re-admits the entry. A broader
              // first pattern such as `**/src` would match the DIRECTORY, and
              // gitignore cannot re-include a child of an excluded directory —
              // which is why the bare specifier is handled by `paths` above.
              group: ["**/src/**", "!**/src/game"],
              allowTypeImports: true,
              message:
                "The harness stands the build up through its entry, `../src/game`. A figure comes from `../constants`.",
            },
          ],
        },
      ],
    },
  },
  {
    // A static clause is what the block above reads, so a dynamic one is the way
    // round it: `await import("../../src/constants")` reaches the same module and
    // is not an import declaration. A computed specifier is untouched — that is
    // how `validation/chromium.ts` loads a browser it has just located on disk —
    // and `require()` is already refused by the recommended set's
    // `@typescript-eslint/no-require-imports`.
    files: ["validation/**/*.ts", "validation/**/*.js"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/src/]",
          message:
            "A validator may not load the build's own sources, dynamically or otherwise. A figure comes from `../constants`.",
        },
      ],
    },
  },
  {
    // `validation/constants.ts` is the exemption above, so it is also where a
    // bypass would be written: one `export * from "../src/constants"` here
    // re-exports the build's whole figure table to every suite in the project,
    // through an import specifier no suite would look wrong. What this file
    // takes from the build it therefore takes by name, one binding at a time,
    // and there is nothing in a table of transcribed figures that a namespace
    // form buys.
    files: ["validation/constants.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Restated: a later block replaces a rule's options rather than adding
          // to them, so dropping this would exempt `constants.ts` from the block
          // above.
          selector: "ImportExpression[source.value=/src/]",
          message:
            "A validator may not load the build's own sources, dynamically or otherwise. A figure comes from `../constants`.",
        },
        {
          selector: "ExportAllDeclaration",
          message:
            "`validation/constants.ts` re-exports by name, never with `export *`: a wildcard would hand every suite the build's own figures.",
        },
        {
          selector: "ImportNamespaceSpecifier",
          message:
            "`validation/constants.ts` imports by name, never as a namespace: a namespace binding hides which figures came from the build.",
        },
      ],
    },
  },
  {
    // `validation/audio-init.js` and `validation/recorder-init.js` are injected
    // into the page and run there, not in this project: their globals are the
    // browser's, and the `const self = this` in the recorder is what a wrapped
    // native method and a `Proxy` handler need, since both rebind `this`.
    // Without this the staged tree cannot lint clean, and a gate that is never
    // green is a gate nobody reads.
    files: ["validation/**/*.js"],
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
      "@typescript-eslint/no-this-alias": ["error", { allowedNames: ["self"] }],
    },
  },
);
