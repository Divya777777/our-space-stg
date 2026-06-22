# Our Space - Backend API

Production-ready backend server for Our Space P2P video chat and music streaming application.

## Features

✅ **Authentication & Security**
- Google OAuth 2.0 integration
- JWT access tokens (24h) & refresh tokens (7d)
- Session management with IP & user agent tracking
- Account lockout after failed attempts
- AES-256-GCM message encryption

✅ **Room Management**
- Create & join rooms with unique codes
- Host approval system (Knock-Knock)
- Recent rooms suggestions (top 5)
- Favorite rooms tracking
- Visit analytics

✅ **Real-Time Messaging**
- End-to-end encrypted messages
- File attachments (2MB limit)
- Message history & search
- System messages

✅ **Music & Playlists**
- YouTube video integration
- Collaborative playlists
- Now playing sync
- Playback history
- Song search

✅ **Enterprise Security**
- Rate limiting (100 req/15min)
- CORS protection
- XSS prevention
- SQL injection prevention
- Comprehensive audit logging

## Tech Stack

- **Runtime:** Node.js 20+ LTS
- **Framework:** Express.js
- **Database:** MySQL 8.0+ with Prisma ORM
- **Authentication:** JWT + Google OAuth
- **Real-time:** PeerJS for WebRTC signaling
- **Security:** Helmet, bcrypt, express-validator

## Quick Start

### Prerequisites

- Node.js 20+ LTS
- MySQL 8.0+
- Google OAuth credentials

### Installation

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Generate secrets (run each command and copy to .env)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"  # JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"  # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # ENCRYPTION_KEY

# Update .env with your values
nano .env
```

### Database Setup

```bash
# Create MySQL database
mysql -u root -p

CREATE DATABASE our_space_production CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ourspace_app'@'localhost' IDENTIFIED BY 'YOUR_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON our_space_production.* TO 'ourspace_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;

# Run database schema
mysql -u ourspace_app -p our_space_production < ../production-database-schema.sql

# Generate Prisma client
npx prisma generate

# Optional: Push schema changes
npx prisma db push
```

### Start Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

Server will start at:
- **API:** http://localhost:3001
- **PeerJS:** http://localhost:9000
- **Health:** http://localhost:3001/health

## Environment Variables

See `.env.example` for all required variables.

### Required Variables

```env
# Database
DATABASE_URL="mysql://user:password@localhost:3306/our_space_production"

# JWT Secrets (64+ characters each)
JWT_SECRET=your_secret_here
JWT_REFRESH_SECRET=your_secret_here
SESSION_SECRET=your_secret_here

# Encryption (32 bytes = 64 hex chars)
ENCRYPTION_KEY=your_key_here

# Google OAuth
GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-secret

# CORS Origins
CORS_ORIGIN=http://localhost:3000,http://localhost:5500
```

## API Endpoints

### Authentication
```
POST   /api/auth/google          # Login with Google
POST   /api/auth/refresh         # Refresh access token
POST   /api/auth/logout          # Logout
GET    /api/auth/verify          # Verify token
```

### Rooms
```
POST   /api/rooms                # Create room
POST   /api/rooms/join           # Join room
POST   /api/rooms/:id/leave      # Leave room
GET    /api/rooms/code/:code     # Get room by code
GET    /api/rooms/:id            # Get room by ID
GET    /api/rooms/user/suggested # Get suggested rooms
POST   /api/rooms/:id/favorite   # Toggle favorite
GET    /api/rooms/:id/pending-requests        # Get join requests (host)
POST   /api/rooms/join-requests/:id/approve   # Approve/reject request
```

### Messages
```
POST   /api/messages/:roomId     # Send message
GET    /api/messages/:roomId     # Get messages
DELETE /api/messages/:id         # Delete message
GET    /api/messages/:roomId/count    # Get message count
GET    /api/messages/:roomId/search   # Search messages
```

### Playlists
```
POST   /api/playlists                         # Create playlist
GET    /api/playlists/room/:roomId            # Get room playlists
POST   /api/playlists/:id/songs               # Add song
DELETE /api/playlists/songs/:id               # Remove song
POST   /api/playlists/room/:roomId/now-playing    # Update now playing
GET    /api/playlists/room/:roomId/now-playing    # Get now playing
GET    /api/playlists/room/:roomId/history        # Get playback history
PUT    /api/playlists/:id/reorder             # Reorder songs
```

### Users
```
GET    /api/users/me                 # Get profile
PUT    /api/users/me/preferences     # Update preferences
PUT    /api/users/me/profile         # Update profile
GET    /api/users/me/sessions        # Get active sessions
DELETE /api/users/me/sessions/:id    # Revoke session
GET    /api/users/me/activity        # Get activity
DELETE /api/users/me                 # Delete account
```

## Project Structure

```
backend/
├── middleware/
│   ├── auth.js           # JWT authentication
│   ├── security.js       # Security headers, rate limiting
│   └── validation.js     # Input validation
├── routes/
│   ├── auth.js           # Auth endpoints
│   ├── rooms.js          # Room endpoints
│   ├── messages.js       # Message endpoints
│   ├── playlists.js      # Playlist endpoints
│   └── users.js          # User endpoints
├── services/
│   ├── roomService.js    # Room business logic
│   ├── messageService.js # Message business logic
│   ├── playlistService.js# Playlist business logic
│   └── userService.js    # User business logic
├── utils/
│   ├── encryption.js     # AES-256-GCM encryption
│   └── auditLogger.js    # Audit logging
├── prisma/
│   └── schema.prisma     # Database schema
├── server.js             # Main server file
├── package.json          # Dependencies
└── .env.example          # Environment template
```

## Security Features

### Authentication
- Google OAuth 2.0 verification
- JWT with short expiry (24h)
- Refresh token rotation (7d)
- Session tracking (IP, user agent)
- Failed login attempt tracking
- Account lockout (5 attempts = 15min)

### Encryption
- AES-256-GCM for messages
- Unique IV per message
- Authentication tags for integrity
- PBKDF2 key derivation (100k iterations)

### API Security
- Helmet.js security headers
- CORS whitelist
- Rate limiting (100/15min)
- Request size limits (2MB)
- HTTP Parameter Pollution prevention
- Input sanitization
- SQL injection prevention

### Monitoring
- Comprehensive audit logs
- Failed login tracking
- Suspicious activity detection
- Security event logging

## Development

### Database Management

```bash
# Open Prisma Studio
npx prisma studio

# Generate Prisma client after schema changes
npx prisma generate

# Push schema to database
npx prisma db push

# Create migration
npx prisma migrate dev --name migration_name
```

### Testing

```bash
# Test health endpoint
curl http://localhost:3001/health

# Test authentication (requires valid Google token)
curl -X POST http://localhost:3001/api/auth/google \
  -H "Content-Type: application/json" \
  -d '{"credential":"YOUR_GOOGLE_TOKEN"}'

# Test protected endpoint (requires access token)
curl http://localhost:3001/api/users/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Common Tasks

```bash
# View logs in development
npm run dev

# Check Prisma schema
npx prisma validate

# Format Prisma schema
npx prisma format

# Seed database (if seeder exists)
npx prisma db seed
```

## Deployment

See `../PRODUCTION_DEPLOYMENT_GUIDE.md` for complete production deployment instructions.

### Quick Deploy Checklist

```bash
# 1. Set up server (Ubuntu 22.04 recommended)
# 2. Install Node.js 20, MySQL 8.0, Nginx
# 3. Clone repository
# 4. Install dependencies
npm install --production

# 5. Set up environment variables
cp .env.example .env.production
# Edit .env.production with production values

# 6. Set up database
mysql -u root -p < ../production-database-schema.sql

# 7. Generate Prisma client
npx prisma generate

# 8. Start with PM2
npm install -g pm2
pm2 start server.js --name our-space-api
pm2 save
pm2 startup

# 9. Configure Nginx as reverse proxy
# 10. Set up SSL with Let's Encrypt
# 11. Configure firewall
```

## Troubleshooting

### Database Connection Issues
```bash
# Test MySQL connection
mysql -u ourspace_app -p our_space_production -e "SELECT 1"

# Check DATABASE_URL format
DATABASE_URL="mysql://user:pass@host:3306/database"
```

### JWT Token Issues
```bash
# Ensure JWT_SECRET is set and long enough
echo $JWT_SECRET  # Should be 64+ characters

# Clear all sessions in database
mysql -u ourspace_app -p our_space_production
DELETE FROM user_sessions;
```

### Prisma Issues
```bash
# Regenerate Prisma client
npx prisma generate --force

# Reset database (WARNING: deletes all data)
npx prisma migrate reset
```

### Port Already in Use
```bash
# Find process using port 3001
lsof -i :3001

# Kill process
kill -9 PID
```

## Performance

### Expected Response Times (with indexes)
- User login: < 50ms
- Room join: < 100ms
- Message send: < 30ms
- Message history (100 msgs): < 200ms
- Playlist load: < 150ms

### Optimization Tips
- Use database indexes (already configured in schema)
- Enable PM2 clustering (2-4 instances)
- Add Redis for session storage (for scaling)
- Use CDN for static assets
- Enable database query caching

## Support

For issues or questions:
1. Check logs: `pm2 logs our-space-api` or `npm run dev` output
2. Review `.env` configuration
3. Verify database connection
4. Check Google OAuth credentials
5. Review audit logs in database

## License

ISC
