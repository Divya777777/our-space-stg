const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');

/**
 * Helmet configuration for security headers
 */
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://accounts.google.com", "https://apis.google.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://accounts.google.com", "wss:", "ws:"],
      frameSrc: ["'self'", "https://accounts.google.com"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "https:", "blob:"],
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny'
  },
  xssFilter: true,
  noSniff: true,
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  }
});

/**
 * CORS configuration
 */
const corsConfig = cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    const allowedOrigins = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : ['http://localhost:3000', 'http://localhost:5500'];

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

/**
 * Create rate limiter with custom configuration
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} max - Max requests per window
 * @param {string} message - Error message
 * @returns {Function} - Rate limiter middleware
 */
function createRateLimiter(windowMs, max, message) {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    // Store in memory (use Redis for production scaling)
    handler: (req, res) => {
      res.status(429).json({
        error: message,
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
  });
}

/**
 * General API rate limiter
 */
const apiLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests
  'Too many requests from this IP, please try again later'
);

/**
 * Strict rate limiter for authentication endpoints
 */
const authLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  50, // 50 requests (increased for development)
  'Too many authentication attempts, please try again later'
);

/**
 * Rate limiter for message sending
 */
const messageLimiter = createRateLimiter(
  60 * 1000, // 1 minute
  30, // 30 messages
  'Too many messages sent, please slow down'
);

/**
 * Rate limiter for room creation
 */
const roomCreationLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  10, // 10 rooms
  'Too many rooms created, please try again later'
);

/**
 * HTTP Parameter Pollution protection
 */
const hppProtection = hpp({
  whitelist: ['roomId', 'userId', 'messageId', 'playlistId']
});

/**
 * Extract IP address from request
 * @param {Object} req - Express request object
 * @returns {string} - IP address
 */
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.headers['x-real-ip'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip
  );
}

/**
 * Extract user agent from request
 * @param {Object} req - Express request object
 * @returns {string} - User agent
 */
function getUserAgent(req) {
  return req.headers['user-agent'] || 'Unknown';
}

/**
 * Sanitize request data to prevent XSS
 * @param {Object} data - Data to sanitize
 * @returns {Object} - Sanitized data
 */
function sanitizeData(data) {
  const sanitizeHtml = require('sanitize-html');

  if (typeof data === 'string') {
    return sanitizeHtml(data, {
      allowedTags: [],
      allowedAttributes: {}
    });
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }

  if (data && typeof data === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeData(value);
    }
    return sanitized;
  }

  return data;
}

/**
 * Request sanitization middleware
 */
function sanitizeRequest(req, res, next) {
  if (req.body) {
    req.body = sanitizeData(req.body);
  }
  if (req.query) {
    req.query = sanitizeData(req.query);
  }
  if (req.params) {
    req.params = sanitizeData(req.params);
  }
  next();
}

/**
 * Security headers middleware
 */
function securityHeaders(req, res, next) {
  // Remove X-Powered-By header
  res.removeHeader('X-Powered-By');

  // Add custom security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  next();
}

module.exports = {
  helmetConfig,
  corsConfig,
  apiLimiter,
  authLimiter,
  messageLimiter,
  roomCreationLimiter,
  hppProtection,
  getClientIp,
  getUserAgent,
  sanitizeRequest,
  securityHeaders,
  createRateLimiter
};
