FROM node:26-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/session/auth
ENV NODE_ENV=production
CMD ["npm", "start"]
