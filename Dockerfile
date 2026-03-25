# Use Node.js 24 Alpine as the base image for a small footprint
FROM node:24-alpine AS base

# Install system dependencies required for native modules and media handling
# ffmpeg: Required for voice/music functionality
# python3: Often required by yt-dlp and node-gyp
# build-base: Includes make, g++, etc. for compiling native modules
RUN apk add --no-cache python3 py3-pip build-base ffmpeg

# Set working directory for all stages
WORKDIR /app

# Dependencies stage: Install node modules
FROM base AS dependencies

# Copy package files strictly for dependency installation
COPY package*.json ./

# Copy scripts folder required for postinstall script (patch-yt-dlp.js)
COPY scripts/ ./scripts/

# Install dependencies
# --omit=dev: Installs only production dependencies
# --legacy-peer-deps: Bypasses strict peer dependency checks
RUN npm ci --omit=dev --legacy-peer-deps

# Release stage: Final runtime image
FROM base AS release

# Copy only production node_modules from the dependencies stage
# Note: We copy as root first to ensure no permission issues during copy
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package.json ./package.json

# Copy application source code
# .dockerignore will filter out unwanted files
COPY . .

# Set permissions securely
# 1. Give ownership to node user
# 2. Ensure standard directory permissions (755) and file permissions (644)
RUN chown -R node:node /app && \
    chmod -R 755 /app

# Switch to non-root user for security
USER node

# Expose the default port (can be overridden by environment variable)
ENV PORT=3000
EXPOSE 3000

# Document environment variables that should be passed at runtime
# NOTE: Do not set actual secrets here. Set them in your deployment platform's dashboard.
# ENV TOKEN=""
# ENV DISCORD_TOKEN=""
ENV NODE_ENV=production

# Start the application
CMD ["node", "index.js"]
