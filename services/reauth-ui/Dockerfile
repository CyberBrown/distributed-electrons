# Reauth UI - OAuth Reauth Web Interface
# Runs on Spark server, reads credentials from mounted volumes

FROM node:20-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 8791

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8791/health || exit 1

# Run the server
CMD ["node", "dist/server.js"]
