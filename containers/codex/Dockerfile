# Run container for the OpenAI Codex harness (slug: codex).
ARG BASE_IMAGE=test-cabinet/base:latest
FROM ${BASE_IMAGE}

# Codex CLI, installed globally into the user-writable npm prefix.
# TODO(linux): pin a specific version once validated on a Docker host.
RUN npm install -g @openai/codex \
	&& npm cache clean --force

# Auth: the API key is supplied at run time as an environment variable
# (OPENAI_API_KEY) and must never be baked into the image. The non-interactive
# invocation flags are confirmed when this image is validated on a Docker host.
