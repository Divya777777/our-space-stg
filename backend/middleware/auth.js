const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { logSecurityEvent } = require('../utils/auditLogger');
const { getClientIp, getUserAgent } = require('./security');

const prisma = new PrismaClient();

/**
 * Generate JWT access token
 * @param {Object} payload - Token payload
 * @returns {string} - JWT token
 */
function generateAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  });
}

/**
 * Generate JWT refresh token
 * @param {Object} payload - Token payload
 * @returns {string} - JWT refresh token
 */
function generateRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  });
}

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @param {boolean} isRefreshToken - Whether this is a refresh token
 * @returns {Object} - Decoded payload
 */
function verifyToken(token, isRefreshToken = false) {
  try {
    const secret = isRefreshToken ? process.env.JWT_REFRESH_SECRET : process.env.JWT_SECRET;
    return jwt.verify(token, secret);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
async function authenticate(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = verifyToken(token);

    // Check if session exists and is active
    const session = await prisma.user_sessions.findFirst({
      where: {
        user_id: decoded.userId,
        access_token: token,
        is_active: true,
        access_expires_at: {
          gt: new Date()
        }
      },
      include: {
        user: {
          select: {
            user_id: true,
            google_id: true,
            email: true,
            display_name: true,
            avatar_url: true,
            account_locked: true,
            locked_until: true
          }
        }
      }
    });

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    // Check if account is locked
    if (session.user.account_locked) {
      if (session.user.locked_until && new Date() > session.user.locked_until) {
        // Unlock account
        await prisma.users.update({
          where: { user_id: session.user.user_id },
          data: {
            account_locked: false,
            locked_until: null,
            failed_login_attempts: 0
          }
        });
      } else {
        return res.status(403).json({
          error: 'Account is locked',
          lockedUntil: session.user.locked_until
        });
      }
    }

    // Update last accessed time
    await prisma.user_sessions.update({
      where: { session_id: session.session_id },
      data: { last_accessed_at: new Date() }
    });

    // Attach user to request
    req.user = session.user;
    req.sessionId = session.session_id;

    next();
  } catch (error) {
    console.error('Authentication error:', error);

    // Log security event
    await logSecurityEvent(
      null,
      'invalid_token',
      getClientIp(req),
      getUserAgent(req),
      { error: error.message }
    );

    return res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Optional authentication middleware
 * Attaches user if token is valid, but doesn't require it
 */
async function optionalAuthenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    const session = await prisma.user_sessions.findFirst({
      where: {
        user_id: decoded.userId,
        access_token: token,
        is_active: true,
        access_expires_at: {
          gt: new Date()
        }
      },
      include: {
        user: {
          select: {
            user_id: true,
            email: true,
            display_name: true,
            avatar_url: true
          }
        }
      }
    });

    if (session && !session.user.account_locked) {
      req.user = session.user;
      req.sessionId = session.session_id;
    }

    next();
  } catch (error) {
    // Ignore errors for optional auth
    next();
  }
}

/**
 * Check if user is room host
 */
async function isRoomHost(req, res, next) {
  try {
    const roomId = req.params.roomId || req.body.roomId;

    if (!roomId) {
      return res.status(400).json({ error: 'Room ID required' });
    }

    const room = await prisma.rooms.findUnique({
      where: { room_id: roomId },
      select: { host_user_id: true }
    });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.host_user_id !== req.user.user_id) {
      return res.status(403).json({ error: 'Only room host can perform this action' });
    }

    next();
  } catch (error) {
    console.error('Host check error:', error);
    return res.status(500).json({ error: 'Failed to verify room host' });
  }
}

/**
 * Check if user is room member
 */
async function isRoomMember(req, res, next) {
  try {
    const roomId = req.params.roomId || req.body.roomId;

    if (!roomId) {
      return res.status(400).json({ error: 'Room ID required' });
    }

    const membership = await prisma.room_members.findFirst({
      where: {
        room_id: parseInt(roomId),
        user_id: parseInt(req.user.user_id),
        left_at: null
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }

    req.membership = membership;
    next();
  } catch (error) {
    console.error('Member check error:', error);
    return res.status(500).json({ error: 'Failed to verify room membership' });
  }
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken(refreshToken) {
  try {
    // Verify refresh token
    const decoded = verifyToken(refreshToken, true);

    // Find session with this refresh token
    const session = await prisma.user_sessions.findFirst({
      where: {
        user_id: decoded.userId,
        refresh_token: refreshToken,
        is_active: true,
        refresh_expires_at: {
          gt: new Date()
        }
      },
      include: {
        user: true
      }
    });

    if (!session) {
      throw new Error('Invalid or expired refresh token');
    }

    // Generate new access token
    const newAccessToken = generateAccessToken({
      userId: session.user.user_id,
      email: session.user.email
    });

    // Update session with new access token
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours

    await prisma.user_sessions.update({
      where: { session_id: session.session_id },
      data: {
        access_token: newAccessToken,
        access_expires_at: expiresAt,
        last_accessed_at: new Date()
      }
    });

    return {
      accessToken: newAccessToken,
      expiresAt
    };
  } catch (error) {
    throw new Error('Failed to refresh token');
  }
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  authenticate,
  optionalAuthenticate,
  isRoomHost,
  isRoomMember,
  refreshAccessToken
};
