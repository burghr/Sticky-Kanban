FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js ./
COPY public ./public

RUN mkdir -p /data
VOLUME ["/data"]

ENV PORT=9889
ENV DATA_DIR=/data
EXPOSE 9889

CMD ["node", "server.js"]
