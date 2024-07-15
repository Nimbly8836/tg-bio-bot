FROM node:20-slim

WORKDIR /app
COPY package*.json tsconfig.json ./

RUN mkdir -p /app/storage

ENV BOT_TOKEN=""

COPY src .

RUN npm i

CMD [ "npm", "start" ]