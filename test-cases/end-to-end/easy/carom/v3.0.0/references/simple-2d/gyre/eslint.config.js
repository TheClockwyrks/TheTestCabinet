// Supplied with the project. Do not edit.
//
// A deliberately small flat config: the ESLint and typescript-eslint recommended
// sets, with unused bindings allowed when they are named with a leading
// underscore (which is how the stubs in `src/game.ts` mark the arguments they do
// not use yet). Linting is not type-aware, so it runs without a TypeScript
// program and stays fast.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

// The case stages its own validators into this project at `validation/`, and the
// two messages below are what the rules under that path say when one of them
// reaches into the build.
//
// A validator grades a build against the SPECIFICATION. The figures it asserts are
// transcribed from the specs into `validation/constants.ts` and imported from
// there, so a check that read a figure out of the build's own `src/` would only be
// asking whether the build agrees with itself — and would pass a build that used
// the wrong number consistently. Two doorways stay open, the same two the
// repository-wide gate (`scripts/ci/validator-constants.sh`) allows:
// `validation/constants.ts`, the project's single import site and the only file
// that may re-export a value the specification genuinely leaves to the build; and a
// type-only clause, which is erased before anything runs and so carries no figure.
const VALIDATOR_SRC_MESSAGE =
  "A validator asserts the specification, not the build. State the figure in " +
  "validation/constants.ts and import it from there — that file alone may read " +
  "the build's src/, and only for a value the specification leaves to the build.";

// The harness is the one file that has to construct the build, so it names the
// build's entry module and nothing else.
const HARNESS_SRC_MESSAGE =
  "The harness may construct the build through ../src/game, and reach no other " +
  "module of it. A figure a check asserts belongs in validation/constants.ts.";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "out/",
      "coverage/",
      "specs/",
      "engine/",
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
  {
    // Every staged validator but the one file allowed its own doorway. The pattern
    // is written as a regex rather than a glob group because a glob group carries
    // gitignore semantics, under which a pattern naming `src` covers everything
    // beneath it and no negation can re-admit a single module — which is exactly
    // what the harness's allowance below needs.
    files: ["validation/**/*.ts", "validation/**/*.js"],
    ignores: ["validation/constants.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)src($|/)",
              allowTypeImports: true,
              message: VALIDATOR_SRC_MESSAGE,
            },
          ],
        },
      ],
      // A dynamic `import()` is invisible to `no-restricted-imports`, which reads
      // static clauses only, so the same reach through
      // `await import("../src/constants")` is refused here instead. The harness
      // inherits this rule — its allowance below reopens the static clause and
      // nothing else.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportExpression > Literal.source[value=/(^|\\/)src($|\\/)/]",
          message: VALIDATOR_SRC_MESSAGE,
        },
      ],
    },
  },
  {
    // The harness's allowance, narrowed to the build's entry module: `../src/game`
    // is admitted and every other path into `src/` — the entry's siblings, and the
    // directory itself — is not.
    files: ["validation/harness.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)src($|/(?!game$))",
              allowTypeImports: true,
              message: HARNESS_SRC_MESSAGE,
            },
          ],
        },
      ],
    },
  },
);
