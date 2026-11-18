# GMshield frontend. Stages the pipeline uses (GMshield-pipeline, "Repository contract"):
#   test              lint, type check, unit tests with coverage, the build guard, and `next build`;
#                     a failure fails the build
#   test-reports      JUnit results and lcov.info, exported for the artifacts and SonarQube
#   stand-in-backend  a tiny Node server that answers the backend's public contract with examples,
#                     for GMSHIELD_MODE=test (Story 1.4 starts it beside the frontend)
#   production        the image that runs (last stage)
# Images are pinned by version and digest: Node 26.13.0 LTS on Alpine 3.24, checked on 2026-11-13.

FROM node:26.13.0-alpine3.24@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=1
# The lockfile first: a source change reuses the dependency layer. No install script runs.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .

FROM build AS test
# The backend types are generated from contracts/public.json by each script below.
RUN npm run lint \
    && npm run typecheck \
    && npm run test:ci \
    && npm run build

FROM scratch AS test-reports
COPY --from=test /workspace/reports/junit/ /junit/
COPY --from=test /workspace/reports/coverage/lcov.info /lcov.info

FROM node:26.13.0-alpine3.24@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS runtime-base
# The package managers are not needed to run, and are only more to patch.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && addgroup -S -g 10001 gmshield \
    && adduser -S -D -H -u 10001 -G gmshield -s /sbin/nologin gmshield
WORKDIR /app

FROM runtime-base AS stand-in-backend
COPY --from=build /workspace/stand-in-backend/server.mjs /app/stand-in-backend/server.mjs
COPY --from=build /workspace/contracts/public.json /app/contracts/public.json
USER 10001:10001
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["node", "/app/stand-in-backend/server.mjs"]

FROM runtime-base AS production
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="gmshield-frontend" \
      org.opencontainers.image.revision="${GIT_SHA}"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# The standalone server and its static files, owned by root: the application cannot change them.
COPY --from=test /workspace/.next/standalone/ /app/
COPY --from=test /workspace/.next/static/ /app/.next/static/
# Not root, and nothing written outside /tmp: the root filesystem can be read-only.
# /tmp is a volume so that `--read-only` works without any other option; a tmpfs on /tmp replaces it.
USER 10001:10001
VOLUME ["/tmp"]
EXPOSE 3000
ENTRYPOINT ["node", "/app/server.js"]
