#!/usr/bin/env bash
# Installs the Rust toolchain and the extra targets The Test Cabinet needs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

bash "$SCRIPT_DIR/rustup.sh"
bash "$SCRIPT_DIR/targets.sh"
