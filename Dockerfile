# Local Kovan image. The process listens on 127.0.0.1 unless KOVAN_HOST is set.
# Publish the host port on loopback only:
#   docker run --rm -e KOVAN_HOST=0.0.0.0 -p 127.0.0.1:4700:4700 ghcr.io/celaldrg/kovan
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/celaldrg/kovan
LABEL org.opencontainers.image.title=kovan
LABEL org.opencontainers.image.description="Local hive for coding-agent sessions"
LABEL org.opencontainers.image.licenses=MIT
RUN useradd --system --create-home --home-dir /var/lib/kovan --shell /usr/sbin/nologin kovan \
  && mkdir -p /opt/kovan /var/lib/kovan \
  && chown -R kovan:kovan /opt/kovan /var/lib/kovan
WORKDIR /opt/kovan
COPY --from=build --chown=kovan:kovan /src/package.json /src/package-lock.json ./
COPY --from=build --chown=kovan:kovan /src/bin ./bin
COPY --from=build --chown=kovan:kovan /src/server ./server
COPY --from=build --chown=kovan:kovan /src/shared ./shared
COPY --from=build --chown=kovan:kovan /src/dist ./dist
COPY --from=build --chown=kovan:kovan /src/vault ./vault
COPY --from=build --chown=kovan:kovan /src/crew.json /src/kovan.config.json /src/rules.example.json ./
USER kovan
ENV KOVAN_DATA=/var/lib/kovan
ENV KOVAN_VAULT=/opt/kovan/vault
EXPOSE 4700
CMD ["node", "server/index.mjs"]
