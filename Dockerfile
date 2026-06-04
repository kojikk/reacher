FROM node:22-alpine

# Install openssh-client for ssh_exec tool
RUN apk add --no-cache openssh-client

# Set working directory
WORKDIR /app

# Copy package files (lockfile included for deterministic, integrity-checked install)
COPY package.json package-lock.json ./

# Deterministic install: npm ci fails if package.json and lockfile diverge, and
# --ignore-scripts blocks postinstall scripts (primary supply-chain RCE vector).
RUN npm ci --omit=dev --ignore-scripts

# Copy application code
COPY . .

# Pre-create the scratch dir owned by node so the named volume inherits node
# ownership (fresh named volumes copy the image path's ownership on first mount).
RUN mkdir -p /data/scratch && chown -R node:node /data

# Drop root: run as the unprivileged 'node' user that ships with the base image
USER node

# Expose port (default 3000, can be overridden)
EXPOSE ${PORT:-3000}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000), (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start the server
CMD ["node", "index.js"]
