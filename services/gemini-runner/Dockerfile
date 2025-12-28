# Gemini Runner - On-Prem Gemini CLI Execution Service
# Runs on Spark (home server) with persistent auth credentials

FROM node:20-slim

# Install dependencies for Gemini CLI
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    gnupg \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install Gemini CLI globally
RUN npm install -g @google/gemini-cli

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDeps for tsc)
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npx tsc

# Remove devDependencies after build
RUN npm prune --production

# Expose port (only localhost via docker-compose)
EXPOSE 8790

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8790/health || exit 1

# Run the server
CMD ["node", "dist/server.js"]
