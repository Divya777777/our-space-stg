#!/bin/bash

# Our Space Backend Setup Script
# This script automates the initial setup process

set -e

echo "════════════════════════════════════════════════════"
echo "  Our Space Backend Setup"
echo "════════════════════════════════════════════════════"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 20+ LTS first."
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Check if MySQL is installed
if ! command -v mysql &> /dev/null; then
    echo "❌ MySQL is not installed. Please install MySQL 8.0+ first."
    exit 1
fi

echo "✅ MySQL detected"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

echo ""
echo "🔑 Generating secrets..."
echo ""

# Generate secrets
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Create .env file
if [ -f .env ]; then
    echo "⚠️  .env file already exists. Creating .env.new instead."
    ENV_FILE=".env.new"
else
    ENV_FILE=".env"
fi

cat > $ENV_FILE << EOF
# Environment
NODE_ENV=development
PORT=3001

# Database URL
# Format: mysql://USER:PASSWORD@HOST:PORT/DATABASE
DATABASE_URL="mysql://ourspace_app:YOUR_PASSWORD_HERE@localhost:3306/our_space_production"

# JWT Secrets (auto-generated)
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
SESSION_SECRET=$SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY

# JWT Expiry
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# Google OAuth (get from Google Cloud Console)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# CORS Origins (comma-separated)
CORS_ORIGIN=http://localhost:5500,http://127.0.0.1:5500

# File Upload
MAX_FILE_SIZE=2097152
UPLOAD_DIR=./uploads

# PeerJS Server
PEERJS_PORT=9000
PEERJS_PATH=/peerjs

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
EOF

echo "✅ Secrets generated and saved to $ENV_FILE"
echo ""

echo "════════════════════════════════════════════════════"
echo "  Next Steps:"
echo "════════════════════════════════════════════════════"
echo ""
echo "1. Set up MySQL database:"
echo "   mysql -u root -p"
echo "   > CREATE DATABASE our_space_production CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo "   > CREATE USER 'ourspace_app'@'localhost' IDENTIFIED BY 'YOUR_PASSWORD';"
echo "   > GRANT SELECT, INSERT, UPDATE, DELETE ON our_space_production.* TO 'ourspace_app'@'localhost';"
echo "   > FLUSH PRIVILEGES;"
echo "   > EXIT;"
echo ""
echo "2. Import database schema:"
echo "   mysql -u ourspace_app -p our_space_production < ../production-database-schema.sql"
echo ""
echo "3. Edit $ENV_FILE:"
echo "   - Update DATABASE_URL with your MySQL password"
echo "   - Add your Google OAuth credentials"
echo "   - Update CORS_ORIGIN with your frontend URL"
echo ""
echo "4. Generate Prisma client:"
echo "   npx prisma generate"
echo ""
echo "5. Start the server:"
echo "   npm run dev"
echo ""
echo "════════════════════════════════════════════════════"
echo "  Setup script complete!"
echo "════════════════════════════════════════════════════"
