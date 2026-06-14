# Run container for the Kilo Code harness (slug: kilo).
ARG BASE_IMAGE=test-cabinet/base:latest
FROM ${BASE_IMAGE}

# Kilo Code CLI, installed globally into the user-writable npm prefix.
# TODO(linux): pin a specific version once validated on a Docker host.
RUN npm install -g @kilocode/cli \
	&& npm cache clean --force

# Auth: the provider API key is supplied at run time as an environment variable
# and must never be baked into the image. The exact variable and the
# non-interactive invocation flags are confirmed when this image is validated on
# a Docker host.
