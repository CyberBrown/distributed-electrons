# Cloudflare Sandbox container for Claude Code execution
# Based on official Cloudflare sandbox image with Claude Code CLI pre-installed

FROM docker.io/cloudflare/sandbox:0.6.6

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Set command timeout to 5 minutes (300000ms)
# This allows for longer-running Claude Code tasks
ENV COMMAND_TIMEOUT_MS=300000

# Expose port for potential web services running inside sandbox
EXPOSE 3000
