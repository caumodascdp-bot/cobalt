FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

FROM base AS build
WORKDIR /app
COPY . /app

RUN corepack enable
RUN apk add --no-cache python3 alpine-sdk

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

RUN pnpm deploy --filter=@imput/cobalt-api --prod /prod/api

FROM base AS api
WORKDIR /app

COPY --from=build --chown=node:node /prod/api /app
COPY --from=build --chown=node:node /app/.git /app/.git

# --- ADICIONE ESTA LINHA AQUI ---
RUN mkdir -p cookies && ln -s /etc/secrets/youtube.txt cookies/youtube.txt && chown -R node:node cookies
# --------------------------------

USER node

EXPOSE 9000
CMD [ "node", "src/cobalt" ]
