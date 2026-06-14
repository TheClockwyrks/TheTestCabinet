# Run container for the Pi coding agent harness (slug: pi).
ARG BASE_IMAGE=test-cabinet/base:latest
FROM ${BASE_IMAGE}

# Pi coding agent CLI, installed globally into the user-writable npm prefix.
# --ignore-scripts mirrors the upstream-recommended install and skips lifecycle
# scripts during the global install.
# TODO(linux): pin a specific version once validated on a Docker host.
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent \
	&& npm cache clean --force

# Auth: the provider API key is supplied at run time as an environment variable
# and must never be baked into the image. The exact variable and the
# non-interactive invocation flags are confirmed when this image is validated on
# a Docker host.
