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

# Cria a pasta de cookies e ajusta as permissões para o usuário node
RUN mkdir -p cookies && chown -R node:node cookies

USER node

EXPOSE 9000

# Copia o arquivo secreto do Render para a pasta cookies na hora do boot e inicia a API
CMD ["node", "start.js"]