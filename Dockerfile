FROM node:24-alpine
WORKDIR /app
COPY package.json server.js index.html style.css app.js config.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
