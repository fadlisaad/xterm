FROM node:22-bookworm-slim

# node-pty requires these to compile its native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html login.html server.js ./

EXPOSE 3000
CMD ["node", "server.js"]
