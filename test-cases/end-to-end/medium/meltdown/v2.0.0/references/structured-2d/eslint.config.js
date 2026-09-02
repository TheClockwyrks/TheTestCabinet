// Supplied with the project. Do not edit.
//
// A deliberately small flat config: the ESLint and typescript-eslint recommended
// sets, with unused bindings allowed when they are named with a leading
// underscore, which is the convention for an argument a function accepts but
// does not use. Linting is not type-aware, so it runs without a TypeScript
// program and stays fast.
//
// It carries one block the seeded copy of this file does not. `validation/` is
// the case's own validator project, which `tcab validate` stages into the tree it
// is checking (from the case's `validation/<engine>/`, at `validation/`); a
// seeded workspace never carries that directory, so the copy handed to a run says
// nothing about it. This copy does, because a reference build is the one tree
// where the validators and the build stand side by side and the rule below can
// actually be run.

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
      "proof/",
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
  // THE CASE'S VALIDATORS MAY NOT READ THE CASE'S FIGURES OFF THE BUILD.
  //
  // Every graded figure a suite asserts is transcribed from the specification
  // into `validation/constants.ts` and imported from there. A suite that instead
  // imports that figure from the build's `src/` stops checking the build against
  // the specification and starts checking the build against itself: a build that
  // walks its movers at 66 units a second where the specs say 60 then passes
  // every arithmetic check put to it, because the check was handed 66 as the
  // figure to expect. That is measured rather than hypothetical — such a build
  // scored a clean sheet on both engine projects, and was caught only by the
  // engineless one, which has no build module to import from.
  //
  // Two files are exempt from the specifier rule, and only these two:
  //
  //   `validation/constants.ts` — the transcription itself, and the one file
  //       allowed to re-export a value the specification genuinely leaves to the
  //       build.
  //   `validation/harness.ts` — the loader, narrowly, for the build's ENTRY
  //       (`../src/game`) and nothing else of it. It has to construct the thing
  //       it drives; every other module of the build is a figure source.
  //
  // The patterns are anchored on `../`, so they name exactly a specifier that
  // climbs out of the staged validator project into the build beside it, and
  // never something a suite imports from within its own project. They cover
  // `export … from` as well as `import`. A type-only clause is allowed, because
  // it carries a name rather than a value and is erased before anything runs.
  //
  // THE FORM RULE BELOW HAS NO EXEMPTIONS, and it is what makes the exemptions
  // above narrow rather than decorative. An exempt file is exempt from WHICH
  // module it may name, not from HOW it may name it: a single
  // `export * from "../src/constants";` appended to `validation/constants.ts`
  // would otherwise republish the build's entire figure table to every suite in
  // the project under the names the suites already import, and the specifier rule
  // would never see it — that is exactly the bypass this gate was written after.
  // A namespace or default binding does the same thing one dereference later, and
  // `import()` and `require()` do it out of sight of `no-restricted-imports`
  // altogether. So a reference into the build must be a named clause, everywhere,
  // and nothing may reach it dynamically at all.
  {
    files: ["validation/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ExportAllDeclaration[source.value=/^(\\.\\.\\/)+src(\\/|$)/]",
          message:
            '`export * from` the build republishes its whole figure table to every suite in this project. Name the values, one clause: `export { A, B } from "…"`.',
        },
        {
          selector:
            "ImportDeclaration[source.value=/^(\\.\\.\\/)+src(\\/|$)/] > ImportNamespaceSpecifier",
          message:
            "A namespace binding takes the build's whole module. Import the names this file actually needs.",
        },
        {
          selector:
            "ImportDeclaration[source.value=/^(\\.\\.\\/)+src(\\/|$)/] > ImportDefaultSpecifier",
          message:
            "A default binding hides what crossed from the build. Import the names this file actually needs.",
        },
        {
          selector: "ImportExpression[source.value=/^(\\.\\.\\/)+src(\\/|$)/]",
          message:
            "A validator does not reach into the build dynamically. Assert the specification's figures, imported from `../constants`.",
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^(\\.\\.\\/)+src(\\/|$)/]",
          message:
            "A validator does not reach into the build dynamically. Assert the specification's figures, imported from `../constants`.",
        },
      ],
    },
  },
  {
    files: ["validation/**/*.ts"],
    ignores: ["validation/constants.ts", "validation/harness.ts"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(\\.\\./)+src(/|$)",
              message:
                "A validator asserts the specification's figures, never the build's. Import the figure from `../constants`, which transcribes the specs; `validation/constants.ts` is the only file in this project that may read the build.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["validation/harness.ts"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(\\.\\./)+src(?:$|/(?!game(?:\\.[A-Za-z]+)?$))",
              message:
                "The harness loads the build's entry, `../src/game`, and nothing else of it. A figure the suites assert belongs in `validation/constants.ts`, transcribed from the specs.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
);
