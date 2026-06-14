#!/usr/bin/env bash
# Applies base OS configuration after apt packages are installed.
set -euo pipefail

# Generate a UTF-8 locale to avoid git and tooling warnings.
locale-gen en_US.UTF-8
update-locale LANG=en_US.UTF-8
