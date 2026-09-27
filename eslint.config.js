import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import importX from "eslint-plugin-import-x";
import jestDom from "eslint-plugin-jest-dom";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import testingLibrary from "eslint-plugin-testing-library";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * The one flat config the TypeScript in this repository is linted with.
 *
 * A flat config governs a tree rather than a package, so the root `lint`
 * script runs `eslint .` once over the repository instead of asking each
 * workspace for a lint script of its own. What is linted is what is written by
 * hand; everything else the repository holds is either generated or built with
 * its own toolchain.
 *
 * The gate is strict by construction: every rule set below is adopted whole and
 * the exceptions are stated here, each with the reason it is one. In particular
 * there is no per-file relaxation of `react-refresh/only-export-components`.
 * That rule reports exactly what Vite's fast refresh cannot patch, so silencing
 * it per file does not make the module reloadable; it only hides the
 * invalidation the development server then reports at runtime. A module that
 * mixes components with anything else is split instead.
 */

/** The sources the type-checked rules read, each inside a project of its own. */
const SOURCES = ["apps/web/src/**/*.{ts,tsx}"];

/** The tests and their helpers, which the testing rules read as well. */
const TESTS = [
  "apps/web/src/**/*.test.{ts,tsx}",
  "apps/web/src/test/**/*.{ts,tsx}",
];

/**
 * The programs that configure a build rather than run in a browser.
 *
 * They are linted without the type-checked rules because a build's
 * configuration is not a member of the project it configures.
 */
const CONFIGS = ["eslint.config.js", "apps/web/vite.config.ts"];

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    // Cargo's build output, because rustdoc's own JavaScript lands in it.
    "**/target/**",
    // The documentation site is Astro's own toolchain, and `astro check` is the
    // gate it answers to.
    "apps/docs/**",
    // Served verbatim rather than compiled. `backend.js` is committed empty and
    // written by whatever serves a build elsewhere.
    "apps/web/public/**",
    // Scratch work, which `.gitignore` keeps out of the repository and the
    // prose and format gates leave alone. It may hold another repository, whose
    // files and whose own configuration are none of this gate's business.
    "tmp/**",
    // The paths the `extra_ignored_paths` answer names, which the prose and
    // format gates leave out too, so no gate reads what the others leave alone.
    "cold-storage/**",
    "tasks/**/done/**",
    ".claude/workflows/**",
    ".claude/worktrees/**",
    "crates/gg/src/probe_fixtures/**",
    "crates/gg/src/sandbox/guests/**",
    "crates/foray-core/schemas/*.json",
    "crates/lattice-core/schemas/*.json",
    "test-cases/performance/hard/lattice/*/cases/*.json",
    "**/*.hbs",
    "**/.build/**",
    "**/.spago/**",
    "**/.vendor/**",
    "**/vendor/**",
    "**/.gg/**",
    "packages/gg-sandbox-purescript/output/**",
    "runs/**",
    "tcab-store/**",
    "tcab-artifacts/**",
    ".tcab-driver/**",
    "reference-previews/**",
  ]),
  {
    // The app's own sources, linted with type information: the type-checked
    // tiers of typescript-eslint are the ones that catch a floating promise or
    // a condition that is always true, which the syntactic tiers cannot see.
    files: SOURCES,
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
      importX.flatConfigs.recommended,
      importX.flatConfigs.typescript,
      unicorn.configs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      // Without the TypeScript resolver every extensionless relative import
      // reads as unresolved, which turns the whole import-x tier off in
      // practice.
      "import-x/resolver": {
        typescript: {
          project: `${import.meta.dirname}/apps/web/tsconfig.json`,
        },
      },
    },
    rules: {
      // Import order is style the formatter cannot express: Prettier sorts
      // nothing, so the grouping is stated here rather than left to habit.
      "import-x/order": [
        "error",
        {
          groups: [
            ["builtin", "external"],
            ["internal", "parent", "sibling", "index"],
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      // A type-only import is erased at build time, and `verbatimModuleSyntax`
      // requires it to say so. This keeps the two spellings from drifting.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],

      // --- unicorn exceptions, each one a house rule it contradicts ---

      // A documentation comment is a single-line `/** … */` where one line
      // says it. The rule wants every block comment expanded to three lines,
      // which is a worse document, not a stricter one.
      "unicorn/single-line-block-comment-style": "off",
      // `null` is the value the DOM and React's own APIs return and accept: a
      // ref is `null` before it attaches, `getAttribute` answers `null`. The
      // code cannot avoid it, so pretending it does only adds assertions.
      "unicorn/no-null": "off",
      // `Props` is React's own vocabulary and the name every reader of this
      // code arrives with. Expanding it to `Properties` is a rename away from
      // the framework, not toward clarity.
      "unicorn/name-replacements": "off",
      // A boolean is named as the predicate it is (`sendable`, `complete`),
      // which reads as prose at the call site. The rule would prefix every one
      // with `is`, saying nothing the type does not.
      "unicorn/consistent-boolean-name": "off",
    },
  },
  {
    // The tests, which are held to the testing rules on top of everything
    // above rather than exempted from any of it.
    files: TESTS,
    extends: [
      vitest.configs.recommended,
      testingLibrary.configs["flat/react"],
      jestDom.configs["flat/recommended"],
    ],
    rules: {
      // Fast refresh has nothing to say about a test file or a test helper,
      // which is where a fixture component and a rendering helper sit
      // together. This is the one file set the rule does not apply to, and it
      // is exempt because the rule is meaningless there, not because a module
      // was inconvenient to split.
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: CONFIGS,
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
