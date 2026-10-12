# Stremio downloads service (no dependencies - plain Node.js)
FROM node:22-alpine

WORKDIR /app
COPY server.js ./

ENV NODE_ENV=production \
    DOWNLOADS_SERVICE_HOST=0.0.0.0 \
    DOWNLOADS_SERVICE_PORT=11471 \
    DOWNLOADS_DIR=/downloads

EXPOSE 11471

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget -q -O /dev/null http://127.0.0.1:11471/api/health || exit 1

CMD ["node", "server.js"]
