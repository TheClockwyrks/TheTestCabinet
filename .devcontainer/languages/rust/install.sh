#!/usr/bin/env bash
# Installs the Rust toolchain, the targets targets.sh adds beside the host's
# own (this architecture's musl target), cargo-nextest, the test runner the
# gate uses, and mold, the linker the glibc targets link with.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

bash "$SCRIPT_DIR/rustup.sh"
bash "$SCRIPT_DIR/targets.sh"
bash "$SCRIPT_DIR/cargo-nextest.sh"
bash "$SCRIPT_DIR/mold.sh"
