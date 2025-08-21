# Imagen oficial con Chromium listo para Puppeteer
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

# Copiar manifests primero para cachear instalación
COPY package.json yarn.lock ./

# Instalar dependencias (ajusta --production según tu flujo)
# Si transpilas TS dentro del contenedor, quita --production
RUN yarn install --production

# Copiar el resto del código
COPY . .

# Exponer (informativo). El puerto real lo leen de process.env.PORT
EXPOSE 8085

# Nota: en PaaS suele requerirse --no-sandbox
# Lánzalo así en tu código:
#   puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })

# Arranque. Asegúrate de que tu script 'start' ya carga .env (dotenv)
CMD ["yarn", "start"]
