# Etapa 1: compilación React/Vite (salida en dist/)
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .

ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# Etapa 2: Nginx sirve estáticos y proxy /api
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 3924

CMD ["nginx", "-g", "daemon off;"]