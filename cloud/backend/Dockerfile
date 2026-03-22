FROM node:20-alpine

# sqlite3 requires native build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY src/ ./src/

RUN mkdir -p data

EXPOSE 3001

CMD ["node", "src/server.js"]
