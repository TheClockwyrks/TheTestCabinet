#!/usr/bin/env bash
# Installs the system libraries required to build the Tauri v2 desktop shell
# (crates/desktop). The CLI (`tcab`) does not need these, but they let
# `cargo build --workspace` succeed.
set -euo pipefail

# System libraries required by Tauri v2 on Linux (WebKitGTK web view, GTK, the
# AppIndicator tray, SVG rendering, and supporting tooling). See
# https://v2.tauri.app/start/prerequisites/.
sudo apt-get update -y
DEBIAN_FRONTEND=noninteractive sudo apt-get install -y \
	file \
	libayatana-appindicator3-dev \
	libgtk-3-dev \
	librsvg2-dev \
	libsoup-3.0-dev \
	libssl-dev \
	libwebkit2gtk-4.1-dev \
	libxdo-dev \
	patchelf \
	wget

# The Tauri CLI (`cargo tauri ...`) is only needed to run or bundle the desktop
# app, not to build it. Install it on demand with `cargo install tauri-cli`.
