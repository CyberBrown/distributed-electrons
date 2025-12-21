# Claude Runner - On-Prem Claude Code Execution Service
# Runs on Spark (home server) with persistent OAuth credentials

FROM node:20-slim

# Install dependencies for Claude Code CLI
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

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
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8787/health || exit 1

# Run the server
CMD ["node", "dist/server.js"]
