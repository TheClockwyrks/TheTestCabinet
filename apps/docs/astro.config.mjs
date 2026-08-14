// @ts-check
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Repairs Expressive Code's external stylesheet, which is broken under this
// project's stack (astro-expressive-code 0.43.1 + Astro 6.4.7 + the satteri
// markdown processor). EC injects `<link href="/_astro/ec.<hash>.css">` into
// every code block, but that asset is never served: in `astro dev` the request
// 404s (Astro's static `/_astro/` handler answers before EC's virtual module
// resolver), and in `astro build` Astro re-hashes the emitted CSS to a
// different filename than the injected link. Either way code blocks render
// completely unstyled — including a bare, icon-less copy button.
//
// EC's own JS asset uses the same mechanism but survives because it is loaded
// as a module (`<script type="module">`), which does go through the resolver.
// This integration patches the CSS side to match.
function fixExpressiveCodeStylesheet() {
  const EC_CSS = /^\/_astro\/ec\.[^/]+\.css$/;
  /** @type {import("astro").AstroIntegration} */
  const integration = {
    name: "fix-expressive-code-stylesheet",
    hooks: {
      // Dev: serve the EC stylesheet by pulling it straight out of EC's Vite
      // virtual module (its `load()` returns raw CSS) before the static
      // middleware can 404 the request.
      "astro:server:setup": ({ server }) => {
        server.middlewares.use(async (req, res, next) => {
          const url = (req.url ?? "").split("?")[0];
          if (!EC_CSS.test(url)) return next();
          try {
            const resolved = await server.pluginContainer.resolveId(url);
            const loaded =
              resolved && (await server.pluginContainer.load(resolved.id));
            const css = typeof loaded === "string" ? loaded : loaded?.code;
            if (css) {
              res.setHeader("Content-Type", "text/css");
              res.end(css);
              return;
            }
          } catch {
            /* fall through to the default handler */
          }
          next();
        });
      },
      // Build: Astro re-hashes the emitted EC stylesheet to a filename that no
      // longer matches the `<link>` EC injected, so point every dangling link
      // at the file that actually shipped.
      "astro:build:done": async ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        let assets;
        try {
          assets = await readdir(path.join(outDir, "_astro"));
        } catch {
          return;
        }
        const ecCss = assets.filter((f) => /^ec\..+\.css$/.test(f));
        if (ecCss.length !== 1) {
          logger.warn(
            `expected exactly one Expressive Code stylesheet, found ${ecCss.length}; skipping link repair`,
          );
          return;
        }
        const realHref = `/_astro/${ecCss[0]}`;
        const dangling = /\/_astro\/ec\.[^"']+\.css/g;
        let patched = 0;
        const walk = async (/** @type {string} */ current) => {
          for (const entry of await readdir(current, { withFileTypes: true })) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
              await walk(entryPath);
            } else if (entry.name.endsWith(".html")) {
              const html = await readFile(entryPath, "utf8");
              const fixed = html.replace(dangling, realHref);
              if (fixed !== html) {
                await writeFile(entryPath, fixed);
                patched++;
              }
            }
          }
        };
        await walk(outDir);
        logger.info(
          `repaired Expressive Code stylesheet link on ${patched} page(s) -> ${realHref}`,
        );
      },
    },
  };
  return integration;
}

// Developer documentation site for The Test Cabinet. Built as a fully static
// bundle by `astro build` and deployed to Cloudflare Pages at docs.testcabinet.ai
// (see .github/workflows/deploy-docs.yml). The public gallery (apps/site) is a
// separate deployment at testcabinet.ai; these are two sites, not one.
//
// `site` is the canonical origin used for generated absolute URLs (sitemap,
// canonical links). The site serves from the subdomain root, so no `base` is set.
export default defineConfig({
  site: "https://docs.testcabinet.ai",
  integrations: [
    fixExpressiveCodeStylesheet(),
    starlight({
      title: "The Test Cabinet",
      description:
        "Developer documentation for The Test Cabinet, a benchmark for AI models and the coding harnesses that drive them.",
      // Brand the docs to match the public gallery (apps/site): the same arcade
      // cabinet mark, favicon, synthwave palette, and monospace type. The palette
      // remap lives in `src/styles/theme.css`; the gallery stays a separate
      // deployment with its own animated backdrop that the docs deliberately omit.
      logo: { src: "./src/assets/cabinet.svg", alt: "The Test Cabinet" },
      favicon: "/cabinet.svg",
      customCss: ["./src/styles/theme.css"],
      // Override the on-this-page table of contents so links above the active
      // heading render muted; see the component for the full rationale.
      components: {
        TableOfContents: "./src/components/TableOfContents.astro",
      },
      // Synthwave code blocks, in keeping with the palette. The theme ships with
      // the Expressive Code integration Starlight already bundles.
      expressiveCode: { themes: ["synthwave-84"] },
      // The order mirrors the system overview on the home page.
      sidebar: [
        { label: "Overview", link: "/" },
        { label: "Terminology", link: "/terminology" },
        // End-user material: short task refreshers, then the detailed guides.
        // Placed above the developer-facing Components section to match the
        // audience split called out on the home page.
        {
          label: "Quickstarts",
          collapsed: true,
          items: [
            "quickstarts/overview",
            {
              label: "Setup",
              collapsed: true,
              items: [
                "quickstarts/setup/set-up-authentication",
                "quickstarts/setup/register-and-login",
              ],
            },
            {
              label: "Development",
              collapsed: true,
              items: [
                "quickstarts/development/run-a-test-case",
                "quickstarts/development/run-the-local-service-stack",
                "quickstarts/development/review-a-run",
              ],
            },
            {
              label: "Authoring",
              collapsed: true,
              items: [
                "quickstarts/authoring/author-an-end-to-end-test-case",
                "quickstarts/authoring/author-a-full-stack-test-case",
                "quickstarts/authoring/author-an-asset-generation-test-case",
                "quickstarts/authoring/author-a-voxel-model-test-case",
                "quickstarts/authoring/author-a-voxel-animation-test-case",
                "quickstarts/authoring/author-a-mesh-model-test-case",
                "quickstarts/authoring/author-a-mesh-animation-test-case",
                "quickstarts/authoring/author-a-skinned-test-case",
                "quickstarts/authoring/author-a-blender-character-test-case",
                "quickstarts/authoring/author-a-ui-test-case",
                "quickstarts/authoring/author-a-material-test-case",
                "quickstarts/authoring/author-a-particle-test-case",
                "quickstarts/authoring/author-an-audio-test-case",
                "quickstarts/authoring/create-an-end-to-end-variant",
                "quickstarts/authoring/create-a-sprite-variant",
                "quickstarts/authoring/create-a-sprite-sheet-variant",
                "quickstarts/authoring/create-a-voxel-model-variant",
                "quickstarts/authoring/create-a-voxel-animation-variant",
                "quickstarts/authoring/create-a-mesh-model-variant",
                "quickstarts/authoring/create-a-mesh-animation-variant",
                "quickstarts/authoring/publish-an-audio-sample-pack",
              ],
            },
            {
              label: "DevOps",
              collapsed: true,
              items: [
                "quickstarts/devops/add-or-update-a-model",
                "quickstarts/devops/publish-a-run",
                "quickstarts/devops/publish-a-reference",
                "quickstarts/devops/publish-errata",
                "quickstarts/devops/roll-prod-service-images",
                "quickstarts/devops/cut-a-release",
              ],
            },
          ],
        },
        {
          label: "User Guides",
          collapsed: true,
          items: [
            "guides/overview",
            {
              label: "Setup",
              collapsed: true,
              items: ["guides/setup/first-time-setup"],
            },
            {
              label: "Development",
              collapsed: true,
              items: [
                "guides/development/running-the-local-service-stack",
                "guides/development/reviewing-test-run-results",
              ],
            },
            {
              label: "Authoring",
              collapsed: true,
              items: [
                "guides/authoring/writing-case-specifications",
                "guides/authoring/authoring-an-end-to-end-test-case",
                "guides/authoring/authoring-a-full-stack-test-case",
                "guides/authoring/authoring-an-asset-generation-test-case",
                "guides/authoring/authoring-a-voxel-model-test-case",
                "guides/authoring/authoring-a-voxel-animation-test-case",
                "guides/authoring/authoring-a-mesh-model-test-case",
                "guides/authoring/authoring-a-mesh-animation-test-case",
                "guides/authoring/authoring-a-skinned-test-case",
                "guides/authoring/authoring-a-blender-character-test-case",
                "guides/authoring/authoring-a-ui-test-case",
                "guides/authoring/authoring-a-material-test-case",
                "guides/authoring/authoring-a-particle-test-case",
                "guides/authoring/authoring-an-audio-test-case",
                "guides/authoring/creating-an-end-to-end-variant",
                "guides/authoring/creating-a-sprite-variant",
                "guides/authoring/creating-a-sprite-sheet-variant",
                "guides/authoring/creating-a-voxel-model-variant",
                "guides/authoring/creating-a-voxel-animation-variant",
                "guides/authoring/creating-a-mesh-model-variant",
                "guides/authoring/creating-a-mesh-animation-variant",
                "guides/authoring/publishing-an-audio-sample-pack",
              ],
            },
            {
              label: "DevOps",
              collapsed: true,
              items: [
                "guides/devops/adding-or-updating-a-model",
                "guides/devops/authoring-errata",
                "guides/devops/publishing-a-test-run-result",
                "guides/devops/publishing-a-reference-implementation",
                "guides/devops/rolling-prod-service-images",
                "guides/devops/cutting-a-release",
              ],
            },
          ],
        },
        {
          label: "Changelogs",
          collapsed: true,
          items: [
            "changelogs/v0.6.2",
            "changelogs/v0.6.1",
            "changelogs/v0.6.0",
            "changelogs/v0.5.1",
            "changelogs/v0.5.0",
            "changelogs/v0.4.1",
            "changelogs/v0.4.0",
            "changelogs/v0.3.2",
            "changelogs/v0.3.1",
            "changelogs/v0.3.0",
            "changelogs/v0.2.0",
            "changelogs/v0.1.0",
          ],
        },
        {
          label: "Components",
          collapsed: true,
          items: [
            // System-wide overview, replacing the old Architecture section. The
            // domain concepts that used to live there now sit under the component
            // that owns them — almost all of them under Core.
            "components/architecture",
            "components/live-streaming",
            {
              label: "Core",
              collapsed: true,
              items: [
                "components/core/overview",
                "components/core/execution",
                "components/core/harnesses",
                "components/core/orchestrators",
                "components/core/events",
                "components/core/metrics",
                "components/core/validation",
                "components/core/run-records",
                "components/core/results",
              ],
            },
            {
              label: "CLI",
              collapsed: true,
              items: ["components/cli/overview"],
            },
            {
              label: "Dispatcher",
              collapsed: true,
              items: ["components/dispatcher/overview"],
            },
            {
              label: "Driver",
              collapsed: true,
              items: ["components/driver/overview"],
            },
            {
              label: "Artifacts",
              collapsed: true,
              items: ["components/artifacts/overview"],
            },
            {
              label: "Tauri",
              collapsed: true,
              items: ["components/tauri/overview"],
            },
            {
              label: "Web",
              collapsed: true,
              items: ["components/web/overview"],
            },
            {
              label: "Backend",
              collapsed: true,
              items: [
                "components/backend/overview",
                "components/backend/api",
                "components/backend/snapshot",
              ],
            },
            {
              label: "Auth",
              collapsed: true,
              items: ["components/auth/overview"],
            },
            {
              label: "Site",
              collapsed: true,
              items: ["components/site/overview"],
            },
            {
              label: "UI",
              collapsed: true,
              items: ["components/ui/overview"],
            },
            {
              label: "Voxel Runtime",
              collapsed: true,
              items: ["components/voxel-runtime/overview"],
            },
            {
              label: "Particle Runtime",
              collapsed: true,
              items: ["components/particle-runtime/overview"],
            },
            {
              label: "Documentation",
              collapsed: true,
              items: ["components/docs/overview"],
            },
          ],
        },
        // Developer-facing build, release, and deployment reference. Migrated
        // from the former top-level DEVELOPMENT.md so the docs are the single
        // authoritative source.
        {
          label: "Development",
          collapsed: true,
          items: [
            "development/building",
            "development/running",
            "development/releasing",
            "development/observability",
            "development/frozen-versions",
          ],
        },
        // Standing up the backend, auth, dispatcher, and artifact services as
        // real, REMOTE environments (runs are per-run Jobs). Releasing (above)
        // covers the static sites + binary, and
        // Running (above) covers the local mirror on one machine; this section is
        // staging + prod. Runnable templates live in the repo's `deployments/`
        // folder, which these pages link to.
        {
          label: "Deployment",
          collapsed: true,
          items: [
            "deployment/overview",
            "deployment/kubernetes",
            "deployment/backups",
            "deployment/telemetry",
          ],
        },
        // The supported coding-agent harnesses. The catalogue overview lists
        // every harness; each harness then has its own Overview (website, model
        // IDs, invocation), Authentication (API-key and, where supported,
        // subscription), Events (raw → normalized event mapping), Metrics
        // (usage/cost extraction), and Telemetry (OpenTelemetry export support
        // and trace linking, including why the unsupported harnesses cannot)
        // pages.
        {
          label: "Harnesses",
          collapsed: true,
          items: [
            "harnesses/overview",
            {
              label: "Anthropic Claude Code",
              collapsed: true,
              items: [
                "harnesses/claude/overview",
                "harnesses/claude/authentication",
                "harnesses/claude/events",
                "harnesses/claude/metrics",
                "harnesses/claude/telemetry",
              ],
            },
            {
              label: "OpenAI Codex",
              collapsed: true,
              items: [
                "harnesses/codex/overview",
                "harnesses/codex/authentication",
                "harnesses/codex/events",
                "harnesses/codex/metrics",
                "harnesses/codex/telemetry",
              ],
            },
            {
              label: "Cline",
              collapsed: true,
              items: [
                "harnesses/cline/overview",
                "harnesses/cline/authentication",
                "harnesses/cline/events",
                "harnesses/cline/metrics",
                "harnesses/cline/telemetry",
              ],
            },
            {
              label: "Goose",
              collapsed: true,
              items: [
                "harnesses/goose/overview",
                "harnesses/goose/authentication",
                "harnesses/goose/events",
                "harnesses/goose/metrics",
                "harnesses/goose/telemetry",
              ],
            },
            {
              label: "Pi",
              collapsed: true,
              items: [
                "harnesses/pi/overview",
                "harnesses/pi/authentication",
                "harnesses/pi/events",
                "harnesses/pi/metrics",
                "harnesses/pi/telemetry",
              ],
            },
            {
              label: "OpenCode",
              collapsed: true,
              items: [
                "harnesses/opencode/overview",
                "harnesses/opencode/authentication",
                "harnesses/opencode/events",
                "harnesses/opencode/metrics",
                "harnesses/opencode/telemetry",
              ],
            },
            {
              label: "Kilo Code",
              collapsed: true,
              items: [
                "harnesses/kilo/overview",
                "harnesses/kilo/authentication",
                "harnesses/kilo/events",
                "harnesses/kilo/metrics",
                "harnesses/kilo/telemetry",
              ],
            },
            {
              label: "Google Antigravity",
              collapsed: true,
              items: [
                "harnesses/antigravity/overview",
                "harnesses/antigravity/authentication",
                "harnesses/antigravity/events",
                "harnesses/antigravity/metrics",
                "harnesses/antigravity/telemetry",
              ],
            },
          ],
        },
        // The built-in orchestrators — the data-driven strategies that decide how
        // a run's harness sessions are conducted (single-session vs multi-session).
        // The catalogue overview lists every orchestrator; each built-in then has
        // its own page. The contract they implement lives under Core.
        {
          label: "Orchestrators",
          collapsed: true,
          items: [
            "orchestrators/overview",
            "orchestrators/one-shot",
            "orchestrators/ralph",
          ],
        },
        // The test types The Test Cabinet evaluates models and harnesses with.
        // Each type gets an Overview (what it is, how it works), Manifests (its
        // `test-case.toml` schema), and Evaluation (how a run is scored). The
        // domain material that used to live under Core's "Test Cases" page now
        // sits under End to End, the only type implemented today.
        {
          label: "Testing",
          collapsed: true,
          items: [
            "testing/overview",
            {
              label: "End to End",
              collapsed: true,
              items: [
                "testing/end-to-end/overview",
                "testing/end-to-end/manifests",
                "testing/end-to-end/instrumentation",
                "testing/end-to-end/evaluation",
              ],
            },
            {
              label: "Full Stack",
              collapsed: true,
              items: [
                "testing/full-stack/overview",
                "testing/full-stack/manifests",
                "testing/full-stack/evaluation",
              ],
            },
            {
              label: "Game Jam",
              collapsed: true,
              items: [
                "testing/game-jam/overview",
                "testing/game-jam/manifests",
                "testing/game-jam/evaluation",
              ],
            },
            {
              label: "Adversarial",
              collapsed: true,
              items: [
                "testing/adversarial/overview",
                "testing/adversarial/manifests",
                "testing/adversarial/evaluation",
                {
                  label: "Pacman (Foray)",
                  collapsed: true,
                  items: [
                    "testing/adversarial/foray/overview",
                    "testing/adversarial/foray/architecture",
                    "testing/adversarial/foray/references",
                    "testing/adversarial/foray/assets",
                  ],
                },
              ],
            },
            {
              label: "Asset Generation",
              collapsed: true,
              items: [
                "testing/asset-generation/overview",
                "testing/asset-generation/sprite-binaries",
                "testing/asset-generation/ui-binaries",
                "testing/asset-generation/material-binaries",
                "testing/asset-generation/voxel-binaries",
                "testing/asset-generation/mesh-binaries",
                "testing/asset-generation/skinned-binaries",
                "testing/asset-generation/blender-binaries",
                "testing/asset-generation/particle-binaries",
                "testing/asset-generation/audio-binaries",
                "testing/asset-generation/rigging-walkers",
                "testing/asset-generation/manifests",
                "testing/asset-generation/evaluation",
              ],
            },
            {
              label: "Performance",
              collapsed: true,
              items: [
                "testing/performance/overview",
                "testing/performance/manifests",
                "testing/performance/evaluation",
                {
                  label: "Factorio (Lattice)",
                  collapsed: true,
                  items: [
                    "testing/performance/lattice/overview",
                    "testing/performance/lattice/architecture",
                    "testing/performance/lattice/references",
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  ],
});
