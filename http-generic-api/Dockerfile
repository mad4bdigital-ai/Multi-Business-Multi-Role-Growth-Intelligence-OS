FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8080
# REDIS_URL must be set at runtime, e.g. redis://your-redis-host:6379
CMD ["npm", "start"]
