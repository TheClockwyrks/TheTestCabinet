---
description: Set up Playwright Chromium screenshots in Ubuntu 26.04 containers before native Playwright support is available.
name: playwright-26.04
---

# Skill: Playwright on Ubuntu 26.04

## Overview

Use this skill when Playwright needs to install or run managed Chromium in an
Ubuntu 26.04 container and Playwright does not yet provide a native
`ubuntu26.04-*` browser download entry.

Playwright can be made to use the Ubuntu 24.04 browser artifacts by setting
`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` to the Ubuntu 24.04 platform that matches
the current CPU architecture. Do not assume a single architecture for this
repository's environments.

## Platform Override

Use the current machine architecture to choose the override:

```sh
case "$(uname -m)" in
    x86_64|amd64)
        export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64
        ;;
    aarch64|arm64)
        export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64
        ;;
    *)
        echo "Unsupported Playwright workaround architecture: $(uname -m)" >&2
        return 1 2>/dev/null || exit 1
        ;;
esac
```

To persist the override for interactive shells, add the same `case` block to
`~/.bashrc` instead of hard-coding one architecture.

## Install Chromium

After the override is set, install Playwright's managed Chromium browser from
the package that owns the Playwright dependency (`packages/browser-driver`):

```sh
cd packages/browser-driver
npx playwright install chromium
```

Playwright may print a warning that the OS is not officially supported. The
warning is expected when this workaround is active.

## Runtime Libraries

Ubuntu 26.04 uses `t64` variants for several runtime libraries. Install the
runtime dependencies required by Playwright's Chromium build:

```sh
sudo apt-get update
sudo apt-get install -y \
    libnss3 libnspr4 \
    libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 \
    libcups2t64 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libdrm2 \
    libpango-1.0-0 libcairo2 \
    libasound2t64 libwayland-client0
```

If Playwright reports additional missing shared libraries, install the packages
listed by Playwright before retrying.

## Smoke Test

Verify Chromium can launch before relying on screenshots:

```sh
cd packages/browser-driver
node - <<'EOF'
const { chromium } = require("playwright");

(async () => {
    const browser = await chromium.launch();
    console.log("OK");
    await browser.close();
})();
EOF
```

## Gallery Screenshot Script

The gallery site's screenshot helper (`apps/site/scripts/screenshot.mjs`) sets
`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` automatically when it detects Ubuntu 26.04 on
`x64` or `arm64`, unless the environment already sets an explicit override. This
keeps screenshot capture working across both amd64 and aarch64 hosts without
hard-coding one host architecture.

Run the screenshot helper from the gallery site folder:

```sh
cd apps/site
npm run screenshot -- / tmp/screenshots/index.png
```
