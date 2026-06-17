// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

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
    starlight({
      title: "The Test Cabinet",
      description:
        "Developer documentation for The Test Cabinet, a benchmark for AI models and the coding harnesses that drive them.",
      // The order mirrors the system overview on the home page.
      sidebar: [
        { label: "Overview", link: "/" },
        { label: "Status", link: "/status" },
        { label: "Roadmap", link: "/roadmap" },
        { label: "Terminology", link: "/terminology" },
        {
          label: "Changelogs",
          items: [
            "changelogs/v0.1.0",
          ],
        },
        {
          label: "Components",
          items: [
            // System-wide overview, replacing the old Architecture section. The
            // domain concepts that used to live there now sit under the component
            // that owns them — almost all of them under Core.
            "components/architecture",
            {
              label: "Core",
              items: [
                "components/core/overview",
                "components/core/test-cases",
                "components/core/execution",
                "components/core/harnesses",
                "components/core/events",
                "components/core/metrics",
                "components/core/validation",
                "components/core/run-records",
                "components/core/results",
              ],
            },
            {
              label: "CLI",
              items: ["components/cli/overview"],
            },
            {
              label: "Worker",
              items: ["components/worker/overview"],
            },
            {
              label: "Tauri",
              items: ["components/tauri/overview"],
            },
            {
              label: "Backend",
              items: ["components/backend/overview"],
            },
            {
              label: "Site",
              items: ["components/site/overview"],
            },
            {
              label: "Documentation",
              items: ["components/docs/overview"],
            },
          ],
        },
      ],
    }),
  ],
});
