# Use official Node.js 18 LTS runtime
FROM node:18-slim AS base

# Create app directory
WORKDIR /usr/src/app

# Install dependencies first (leverage layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

# Default port Cloud Run expects
ENV PORT=8080

# Health endpoint
EXPOSE 8080

CMD ["npm", "start"]
