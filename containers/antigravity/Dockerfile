# Run container for the Google Antigravity harness (slug: antigravity).
ARG BASE_IMAGE=test-cabinet-base:latest
FROM ${BASE_IMAGE}

# Antigravity CLI. The installer is a curl-piped script; its install location and
# headless behavior are among the least predictable of the supported harnesses.
# TODO(linux): confirm the install path lands on PATH and pin a version once
# validated on a Docker host.
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash

# Auth: the provider API key is supplied at run time as an environment variable
# and must never be baked into the image. The exact variable and the
# non-interactive invocation flags are confirmed when this image is validated on
# a Docker host.
