FROM python:3.10-bookworm AS pydeps
WORKDIR /tmp
COPY parser/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt

FROM node:20-bookworm AS ui
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js postcss.config.js tailwind.config.js index.html ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm AS prod_deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends tor obfs4proxy \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY --from=prod_deps /app/node_modules ./node_modules
COPY server ./server
COPY parser ./parser
COPY --from=ui /app/dist ./dist
COPY --from=pydeps /usr/local /usr/local
COPY docker/torrc /etc/tor/torrc
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
ENV PYTHONUNBUFFERED=1
ENV TELETHON_PYTHON=/usr/local/bin/python3.10
ENV SOFTPROG_PARSER_DIR=parser
RUN chmod 644 /etc/tor/torrc \
  && chmod 755 /usr/local/bin/entrypoint.sh \
  && mkdir -p /app/data /app/sessions /app/tor-data \
  && chown -R node:node /app
USER node
EXPOSE 8787
CMD ["/usr/local/bin/entrypoint.sh"]
