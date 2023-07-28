FROM node:slim
LABEL maintainer="Dennis Pfisterer, http://dennis-pfisterer.de"

# Set node environment, either development or production
ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

# Create app directory
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json /app/
RUN npm install --no-optional && npm cache clean --force

# Copy app files
COPY index.js /app/
COPY stylesheet.css /app/

# Export app port and set entrypoint at startup
EXPOSE 3000
CMD ["node", "index.js"]
