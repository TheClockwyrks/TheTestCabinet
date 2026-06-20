// Generate a `models/<slug>.toml` catalog entry from an OpenRouter slug.
//
// The Test Cabinet's model catalog (see `crates/core/src/models.rs`) is five
// fields per model, and pricing / context window / release date are *not* among
// them — those are fetched live from OpenRouter by `tcab catalog` at build time.
// So everything an entry needs can be derived from OpenRouter's `/models`
// listing, except `model_ids`: those are the IDs a harness writes into a run
// record (`subject.modelId`), which OpenRouter does not know. Most harnesses
// route through OpenRouter and report the OpenRouter slug, so that is the
// default. OpenAI and Anthropic are the exceptions: they run through Codex and
// Claude Code, which report a provider-native ID, so for those providers the
// entry lists both the native ID and the OpenRouter slug (see
// `docs/harnesses.md`). The native ID is the part after the `/`, with Anthropic's
// `X.Y` version dots rewritten to the `X-Y` dashes Claude Code reports.
//
// Every entry also lists the OpenRouter slug prefixed with `openrouter/`: OpenCode
// and Kilo Code route through OpenRouter but report the slug under their own
// `openrouter/` provider id (e.g. `openrouter/anthropic/claude-opus-4.8`), so
// without this form their runs would map to no model at all.
//
// The site-facing `<slug>.md` description is *not* generated here — it is written
// by hand. A placeholder stub is created only when one does not already exist, so
// the catalog resolves; existing prose is never overwritten.
//
// Usage:
//   node scripts/add-model.mjs <openrouter-slug> [output-slug]
//
//   <openrouter-slug>  The id OpenRouter lists the model under, e.g.
//                      `anthropic/claude-opus-4.8` or `openrouter/pareto-code`.
//   [output-slug]      Optional file stem for `models/<stem>.toml`. Defaults to
//                      the part after the `/`. Pass an override to match a
//                      harness's own id convention (e.g. `claude-opus-4-8`).
//
// Set TCAB_OR_MODELS_CACHE to a saved copy of the `/models` JSON to skip the
// network fetch — handy when generating several entries in a row.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const MODELS_DIR = path.resolve(fileURLToPath(new URL("../models", import.meta.url)));

/** Fetch (or load from cache) OpenRouter's full model listing. */
async function loadOpenRouterModels() {
  const cache = process.env.TCAB_OR_MODELS_CACHE;
  if (cache && fs.existsSync(cache)) {
    return JSON.parse(fs.readFileSync(cache, "utf8")).data;
  }
  const response = await fetch(MODELS_URL);
  if (!response.ok) {
    throw new Error(`fetching ${MODELS_URL}: HTTP ${response.status}`);
  }
  return (await response.json()).data;
}

/**
 * Split OpenRouter's display name into a provider and a model name. Most names
 * are `"Provider: Model Name"`; when there is no colon (e.g. the Pareto Code
 * Router) the provider is derived from the slug prefix and the whole name is
 * kept as the model name.
 */
function splitName(displayName, slug) {
  const index = displayName.indexOf(": ");
  if (index !== -1) {
    return {
      provider: displayName.slice(0, index),
      name: displayName.slice(index + 2),
    };
  }
  const prefix = slug.split("/")[0] ?? "";
  const provider = prefix === "openrouter" ? "OpenRouter" : prefix;
  return { provider, name: displayName };
}

/**
 * The model IDs a run record may identify this model by, and the comment that
 * explains them. Codex and Claude Code report a provider-native ID, so OpenAI and
 * Anthropic entries list both that native ID and the OpenRouter slug; every other
 * harness routes through OpenRouter and reports the slug. Every entry also lists
 * the slug under OpenCode/Kilo Code's `openrouter/` provider prefix.
 */
function modelIdsFor(slug) {
  const [prefix, ...rest] = slug.split("/");
  const tail = rest.join("/");
  // OpenCode and Kilo Code route through OpenRouter but report the slug under
  // their own `openrouter/` provider id, e.g. `openrouter/anthropic/claude-opus-4.8`.
  const openrouterId = `openrouter/${slug}`;
  if (prefix === "openai") {
    return {
      ids: [tail, slug, openrouterId],
      comment:
        "# The model ID strings as they appear in run records (`subject.modelId`), used\n" +
        "# to map a run back to this model. Codex reports the bare OpenAI id; the\n" +
        "# OpenRouter slug (with the `openai/` prefix) is what OpenRouter-routed harnesses\n" +
        "# report, and OpenCode/Kilo Code prefix that slug with their `openrouter/` provider id.",
    };
  }
  if (prefix === "anthropic") {
    return {
      ids: [tail.replace(/\./g, "-"), slug, openrouterId],
      comment:
        "# The model ID strings as they appear in run records (`subject.modelId`), used\n" +
        "# to map a run back to this model. Claude Code reports the bare Anthropic id\n" +
        "# (version dashes, e.g. `claude-opus-4-8`); the OpenRouter slug (dotted, e.g.\n" +
        "# `anthropic/claude-opus-4.8`) is what OpenRouter-routed harnesses report, and\n" +
        "# OpenCode/Kilo Code prefix that slug with their `openrouter/` provider id.",
    };
  }
  return {
    ids: [slug, openrouterId],
    comment:
      "# The model ID strings as they appear in run records (`subject.modelId`), used\n" +
      "# to map a run back to this model. The OpenRouter slug is what OpenRouter-routed\n" +
      "# harnesses report unchanged; OpenCode/Kilo Code prefix it with their\n" +
      "# `openrouter/` provider id.",
  };
}

/** Render the TOML body for a model entry, mirroring the catalog's house style. */
function renderToml({ name, provider, slug, descriptionFile }) {
  const { ids, comment } = modelIdsFor(slug);
  const idList = ids.map((id) => JSON.stringify(id)).join(", ");
  return `# The Test Cabinet model catalog entry.
#
# Site-facing metadata for a single model: how it is named, who provides it, how
# it maps onto OpenRouter for pricing, and which model IDs identify it in run
# records. This file has no bearing on how a run is executed; see
# \`docs/test-cases.md\` for the test case catalog it mirrors.

# Human-readable display name.
name = ${JSON.stringify(name)}

# The provider that serves the model.
provider = ${JSON.stringify(provider)}

# The slug OpenRouter lists the model under. Used to build the model's OpenRouter
# page link and to look up comparable per-token pricing.
openrouter_slug = ${JSON.stringify(slug)}

# Site-facing prose, relative to this catalog directory.
description = ${JSON.stringify(descriptionFile)}

${comment}
model_ids = [${idList}]
`;
}

/** A clearly-marked placeholder description, written only when none exists. */
function renderStubMarkdown(name) {
  return `<!-- TODO: replace this stub with a hand-written, site-facing description.
     See claude-haiku-4-5.md or gpt-5.4-mini.md for the house style. -->

**${name}** — description pending.
`;
}

async function main() {
  const [slug, outputSlugArg] = process.argv.slice(2);
  if (!slug) {
    console.error("usage: node scripts/add-model.mjs <openrouter-slug> [output-slug]");
    process.exit(2);
  }

  const models = await loadOpenRouterModels();
  const model = models.find((m) => m.id === slug);
  if (!model) {
    throw new Error(`model \`${slug}\` not found in the OpenRouter catalog`);
  }

  const { provider, name } = splitName(model.name, slug);
  const outputSlug = outputSlugArg ?? slug.split("/").slice(1).join("/");
  if (outputSlug.includes("/")) {
    throw new Error(
      `derived output slug \`${outputSlug}\` contains a "/"; pass an explicit output-slug`,
    );
  }

  const descriptionFile = `${outputSlug}.md`;
  const tomlPath = path.join(MODELS_DIR, `${outputSlug}.toml`);
  const mdPath = path.join(MODELS_DIR, descriptionFile);

  fs.writeFileSync(tomlPath, renderToml({ name, provider, slug, descriptionFile }));
  console.log(`wrote ${path.relative(process.cwd(), tomlPath)}  (${provider} / ${name})`);

  if (fs.existsSync(mdPath)) {
    console.log(`kept  ${path.relative(process.cwd(), mdPath)}  (already exists)`);
  } else {
    fs.writeFileSync(mdPath, renderStubMarkdown(name));
    console.log(`stub  ${path.relative(process.cwd(), mdPath)}  (fill in by hand)`);
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
