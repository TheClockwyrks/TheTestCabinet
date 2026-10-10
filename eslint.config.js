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
 *
 * Code that came under the gate after it was written is held to it by a
 * ratchet rather than exempted from it. `eslint-suppressions.json` records, per
 * file and per rule, how many errors that code already had; ESLint reports a
 * file whose count for a rule grows past its record, and any error in a file
 * the record does not name. A count that shrinks passes, and
 * `npm run lint:prune` lowers the record to match.
 */

/**
 * The TypeScript projects this gate lints with type information.
 *
 * Each is a folder of browser sources and the `tsconfig.json` that owns them,
 * which the import resolver reads for the folder's paths and aliases. Every
 * file set below is derived from this list, so bringing a project under the
 * gate is one entry here. A project that arrives with violations of its own is
 * recorded in the ratchet's baseline, `eslint-suppressions.json`, with
 * `npm run lint:baseline` (see the Linting section of
 * `apps/docs/src/content/docs/development/building.md`).
 */
const PROJECTS = [
  { sources: "apps/web/src", tsconfig: "apps/web/tsconfig.json" },
  { sources: "packages/ui/src", tsconfig: "packages/ui/tsconfig.json" },
  { sources: "apps/site/src", tsconfig: "apps/site/tsconfig.json" },
  {
    sources: "apps/lattice-designer/src",
    tsconfig: "apps/lattice-designer/tsconfig.json",
  },
];

/** The sources the type-checked rules read, each inside a project of its own. */
const SOURCES = PROJECTS.map(({ sources }) => `${sources}/**/*.{ts,tsx}`);

/** The tests and their helpers, which the testing rules read as well. */
const TESTS = PROJECTS.flatMap(({ sources }) => [
  `${sources}/**/*.test.{ts,tsx}`,
  `${sources}/test/**/*.{ts,tsx}`,
]);

/**
 * The programs that configure a build rather than run in a browser.
 *
 * They are linted without the type-checked rules because a build's
 * configuration is not a member of the project it configures. A Vite plugin a
 * configuration loads (the gallery's two, the designer's scenario API) is part
 * of that configuration.
 */
const CONFIGS = [
  "eslint.config.js",
  "apps/web/vite.config.ts",
  "apps/site/vite.config.ts",
  "apps/site/vite-plugin-*.ts",
  "apps/lattice-designer/vite.config.ts",
  "apps/lattice-designer/vitest.config.ts",
  "apps/lattice-designer/scenario-api.ts",
];

/**
 * The gallery's capture and screenshot tools, which run from a checkout and
 * belong to no TypeScript project, so they too are linted without type
 * information. They drive a browser from Node and render a page in it, so both
 * environments' globals apply.
 */
const TOOLS = ["apps/site/scripts/**/*.{mjs,ts,tsx}"];

/**
 * Raises every rule a preset sets to `warn` to an error.
 *
 * The gate has one tier. A warning fails nothing, and the ratchet's baseline
 * records errors only, so a warning left as one could multiply without the
 * gate ever saying so. A rule worth adopting is worth an error.
 */
function escalate(configs) {
  const error = (level) => (level === "warn" || level === 1 ? "error" : level);
  return configs.map((config) =>
    config.rules === undefined
      ? config
      : {
          ...config,
          rules: Object.fromEntries(
            Object.entries(config.rules).map(([rule, entry]) => [
              rule,
              Array.isArray(entry)
                ? [error(entry[0]), ...entry.slice(1)]
                : error(entry),
            ]),
          ),
        },
  );
}

const CONFIG = defineConfig([
  {
    // A suppression comment that no longer suppresses anything is an error
    // too, for the same reason.
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    // Cargo's build output, because rustdoc's own JavaScript lands in it.
    "**/target/**",
    // The documentation site is Astro's own toolchain, and `astro check` is the
    // gate it answers to.
    "apps/docs/**",
    // Served verbatim rather than compiled. `backend.js` is committed empty and
    // written by whatever serves a build elsewhere. The gallery's is its static
    // assets.
    "apps/web/public/**",
    "apps/site/public/**",
    // Scratch work, which `.gitignore` keeps out of the repository and the
    // prose and format gates leave alone. It may hold another repository, whose
    // files and whose own configuration are none of this gate's business.
    "tmp/**",
    // The project's own ignored paths, which the prose and format gates
    // (.markdownlint-cli2.yaml, cspell.json, .prettierignore) leave out too, so no
    // gate reads what the others leave alone.
    "cold-storage/**",
    // The contracts repository, a submodule with gates of its own.
    "contracts/**",
    "tasks/**/done/**",
    ".claude/workflows/**",
    ".claude/worktrees/**",
    "crates/gg/src/probe_fixtures/**",
    "crates/gg/src/sandbox/guests/**",
    "crates/foray-core/schemas/*.json",
    "crates/lattice-core/schemas/*.json",
    "test-cases/performance/hard/lattice/*/cases/*.json",
    "crates/*/testdata/definitions/**",
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
          project: PROJECTS.map(
            ({ tsconfig }) => `${import.meta.dirname}/${tsconfig}`,
          ),
          // One project per linted folder is the shape PROJECTS states, not an
          // oversight the resolver needs to point out on every run.
          noWarnOnMultipleProjects: true,
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
  {
    files: TOOLS,
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
]);

export default escalate(CONFIG);
