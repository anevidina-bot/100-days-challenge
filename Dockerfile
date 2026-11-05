FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts web-push@3.6.7
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir /app/data /app/backups && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/app/data BACKUP_DIR=/app/backups
EXPOSE 8787
CMD ["node","--env-file-if-exists=.env","src/server.mjs"]
