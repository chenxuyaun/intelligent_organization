FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    APP_MODE=product \
    HOST=0.0.0.0 \
    PORT=4173 \
    DATA_DIR=/var/lib/org-intelligence/current

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node scripts/workspace-data.js ./scripts/workspace-data.js
RUN install -d -o node -g node /var/lib/org-intelligence

USER node
EXPOSE 4173
CMD ["node", "--no-warnings", "server/index.js"]
