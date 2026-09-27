"""Typecheck the documentation site (astro check).

It runs the site's own `typecheck` script through the npm workspace, which is
`astro check`: the frontmatter of every page against the content schema
`apps/docs/src/content.config.ts` declares, the site's configuration, and the
TypeScript in any component. A page whose frontmatter no longer compiles builds
into a site missing it, and nothing else here reads that.
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so npm finds the workspace regardless of the
# caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")

if not succeeded(["npm", "run", "--silent", "--workspace", "apps/docs", "typecheck"]):
    fail(
        "",
        "The documentation site does not typecheck. Reproduce it with:",
        "    npm run --workspace apps/docs typecheck",
    )
