const express = require('express');
const router = express.Router();
const { authenticateWithGoogle, logout } = require('../services/userService');
const { authenticate, refreshAccessToken } = require('../middleware/auth');
const { validateGoogleAuth } = require('../middleware/validation');
const { authLimiter, getClientIp, getUserAgent } = require('../middleware/security');
const { logAuth, logFailedLogin } = require('../utils/auditLogger');

/**
 * POST /api/auth/google
 * Authenticate with Google OAuth
 */
router.post('/google', authLimiter, validateGoogleAuth, async (req, res) => {
  try {
    const { credential } = req.body;
    const ipAddress = getClientIp(req);
    const userAgent = getUserAgent(req);

    const result = await authenticateWithGoogle(credential, ipAddress, userAgent);

    // Log successful authentication
    await logAuth(
      result.user.userId,
      'google_login',
      true,
      ipAddress,
      userAgent
    );

    res.json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt
    });
  } catch (error) {
    console.error('Google auth error:', error);

    // Log failed authentication
    await logFailedLogin(
      req.body.credential || 'unknown',
      getClientIp(req),
      getUserAgent(req),
      error.message
    );

    res.status(401).json({
      success: false,
      error: 'Authentication failed',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', authLimiter, async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'Refresh token is required'
      });
    }

    const result = await refreshAccessToken(refreshToken);

    res.json({
      success: true,
      accessToken: result.accessToken,
      expiresAt: result.expiresAt
    });
  } catch (error) {
    console.error('Refresh token error:', error);

    res.status(401).json({
      success: false,
      error: 'Failed to refresh token',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout user and invalidate session
 */
router.post('/logout', async (req, res) => {
  try {
    // Session ID should be attached by authenticate middleware
    if (req.sessionId) {
      await logout(req.sessionId);

      await logAuth(
        req.user.user_id,
        'logout',
        true,
        getClientIp(req),
        getUserAgent(req)
      );
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to logout'
    });
  }
});

/**
 * GET /api/auth/verify
 * Verify if current token is valid
 */
router.get('/verify', authenticate, async (req, res) => {
  // If we reach here, authenticate middleware already verified the token
  res.json({
    success: true,
    user: {
      userId: req.user.user_id.toString(),
      email: req.user.email,
      displayName: req.user.display_name,
      avatarUrl: req.user.avatar_url
    }
  });
});

module.exports = router;
