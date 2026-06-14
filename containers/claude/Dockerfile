# Run container for the Anthropic Claude Code harness (slug: claude).
ARG BASE_IMAGE=test-cabinet/base:latest
FROM ${BASE_IMAGE}

# Claude Code CLI. The installer drops the binary into ~/.local/bin, which the
# base image already has on PATH.
# TODO(linux): pin a specific version once validated on a Docker host.
RUN curl -fsSL https://claude.ai/install.sh | bash

# Auth: the API key is supplied at run time as an environment variable
# (ANTHROPIC_API_KEY) and must never be baked into the image. The non-interactive
# invocation flags are confirmed when this image is validated on a Docker host.
