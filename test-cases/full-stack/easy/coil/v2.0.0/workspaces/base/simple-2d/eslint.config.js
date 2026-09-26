// Supplied with the project. Do not edit.
//
// A deliberately small flat config: the ESLint and typescript-eslint recommended
// sets, with unused bindings allowed when they are named with a leading
// underscore (which is how the stubs in `src/game.ts` mark the arguments they do
// not use yet). Linting is not type-aware, so it runs without a TypeScript
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
      "specs/",
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
);
