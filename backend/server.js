require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { PeerServer } = require('peer');
const morgan = require('morgan');

// Import middleware
const {
  helmetConfig,
  corsConfig,
  apiLimiter,
  hppProtection,
  sanitizeRequest,
  securityHeaders
} = require('./middleware/security');

// Import routes
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const messageRoutes = require('./routes/messages');
const playlistRoutes = require('./routes/playlists');
const userRoutes = require('./routes/users');

// Import utilities
const { logAuditEvent, Severity } = require('./utils/auditLogger');

// Initialize Express app
const app = express();
const prisma = new PrismaClient();

// Configuration
const PORT = process.env.PORT || 3001;
const PEERJS_PORT = process.env.PEERJS_PORT || 9000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ====================
// Middleware Setup
// ====================

// Security headers
app.use(helmetConfig);
app.use(securityHeaders);

// CORS
app.use(corsConfig);

// Request parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// HTTP Parameter Pollution protection
app.use(hppProtection);

// Request sanitization
app.use(sanitizeRequest);

// Logging
if (NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting
app.use('/api', apiLimiter);

// ====================
// Routes
// ====================

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: NODE_ENV,
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/users', userRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Our Space API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      rooms: '/api/rooms',
      messages: '/api/messages',
      playlists: '/api/playlists',
      users: '/api/users'
    }
  });
});

// ====================
// Error Handling
// ====================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

// Global error handler
app.use(async (err, req, res, next) => {
  console.error('Error:', err);

  // Log critical errors
  if (err.status >= 500 || !err.status) {
    await logAuditEvent({
      userId: req.user?.user_id || null,
      action: 'error',
      details: {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
      },
      severity: Severity.ERROR
    });
  }

  // Don't leak error details in production
  const message = NODE_ENV === 'production'
    ? 'An error occurred'
    : err.message;

  const statusCode = err.status || err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ====================
// PeerJS Server Setup
// ====================

const peerServer = PeerServer({
  port: PEERJS_PORT,
  path: process.env.PEERJS_PATH || '/peerjs',
  allow_discovery: false
});

peerServer.on('connection', (client) => {
  console.log(`PeerJS client connected: ${client.id}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`PeerJS client disconnected: ${client.id}`);
});

// ====================
// Server Startup
// ====================

async function startServer() {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    // Start Express server
    const server = app.listen(PORT, () => {
      console.log('');
      console.log('================================================');
      console.log('🚀 Our Space Backend Server');
      console.log('================================================');
      console.log(`Environment: ${NODE_ENV}`);
      console.log(`API Server: http://localhost:${PORT}`);
      console.log(`PeerJS Server: http://localhost:${PEERJS_PORT}`);
      console.log(`Health Check: http://localhost:${PORT}/health`);
      console.log('================================================');
      console.log('');
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      console.log(`\n${signal} received. Starting graceful shutdown...`);

      server.close(async () => {
        console.log('HTTP server closed');

        // Close database connection
        await prisma.$disconnect();
        console.log('Database connection closed');

        console.log('Shutdown complete');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    console.error('Failed to start server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Start the server
startServer();

// Export for testing
module.exports = app;
