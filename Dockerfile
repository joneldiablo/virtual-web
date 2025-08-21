# ---------- STAGE 1: BUILD ----------
FROM node:20-bullseye AS builder

WORKDIR /app

# Habilita Yarn con Corepack
RUN corepack enable && corepack prepare yarn@1.22.22 --activate

# Copiamos manifests primero (mejor cache)
COPY package.json yarn.lock ./

# Instala TODAS las deps, incluidas dev
RUN yarn install --frozen-lockfile

# Copiamos el resto del proyecto
COPY . .

# Compilamos a dist/
RUN yarn build

# ---------- STAGE 2: RUNTIME ----------
FROM ghcr.io/puppeteer/puppeteer:latest

# Carpeta de trabajo
WORKDIR /app

# Menos ruido de warnings
ENV PUPPETEER_DISABLE_HEADLESS_WARNING=true

# --- Instalar Yarn de forma segura ---
# La imagen usa 'pptruser' por defecto; elevamos a root solo para habilitar Yarn
USER root
# Opción recomendada: usar Corepack (incluido con Node) para activar Yarn 1.x
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
# Si prefieres el método clásico, descomenta esta línea en lugar de la de arriba:
# RUN npm i -g yarn@1
# Volver al usuario no-root
USER pptruser

# Copiamos package.json/yarn.lock para instalar solo deps de producción
COPY --chown=pptruser:pptruser package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile

# Copiamos SOLO artefactos necesarios desde el builder
COPY --chown=pptruser:pptruser --from=builder /app/dist ./dist
COPY --chown=pptruser:pptruser --from=builder /app/bin ./bin

EXPOSE 8085

# Nota: en PaaS suele requerirse --no-sandbox
# Lánzalo así en tu código:
#   puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })

# Arranque. Asegúrate de que tu script 'start' ya carga .env (dotenv)
CMD ["yarn", "start"]
