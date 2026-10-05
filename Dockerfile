FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./

# Valores por defecto para KyraCloud; las variables de entorno del panel los sobrescriben.
ENV PORT=3000
ENV MAX_HISTORY=50
ENV ALLOWED_ORIGINS=https://frontend-ee5078.kyracloud.com

EXPOSE 3000

CMD ["npm", "start"]
