# Run container for the Block goose harness (slug: goose).
ARG BASE_IMAGE=test-cabinet-base:latest
FROM ${BASE_IMAGE}

# goose CLI. CONFIGURE=false skips the interactive configuration the installer
# would otherwise run. The binary installs into ~/.local/bin, which the base
# image already has on PATH.
# TODO(linux): pin a specific release once validated on a Docker host.
RUN curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh \
	| CONFIGURE=false bash

# Auth: the provider API key is supplied at run time as an environment variable
# and must never be baked into the image. The exact variable and the
# non-interactive invocation flags are confirmed when this image is validated on
# a Docker host.
