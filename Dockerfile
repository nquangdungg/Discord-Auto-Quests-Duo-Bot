FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src

# tsx for running TypeScript directly (devDeps may be omitted — install tsx)
RUN npm install tsx typescript --no-save

ENV NODE_ENV=production

CMD ["npx", "tsx", "src/index.ts"]
