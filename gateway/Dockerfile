FROM node:20-alpine

# better-sqlite3 is a native addon — needs build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY iot.js ./

# SQLite DB lives here — mount a volume to persist across restarts
VOLUME ["/data"]

CMD ["node", "iot.js"]
