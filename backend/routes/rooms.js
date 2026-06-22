const express = require('express');
const router = express.Router();
const {
  createRoom,
  getRoomByCode,
  getRoomById,
  joinRoom,
  leaveRoom,
  handleJoinRequest,
  getPendingRequests,
  getSuggestedRooms,
  toggleFavorite
} = require('../services/roomService');
const { authenticate, isRoomHost } = require('../middleware/auth');
const {
  validateRoomCreation,
  validateRoomJoin,
  validateJoinApproval,
  validateRoomVisit,
  validateFavoriteToggle
} = require('../middleware/validation');
const { roomCreationLimiter } = require('../middleware/security');
const { logRoomEvent } = require('../utils/auditLogger');

/**
 * POST /api/rooms
 * Create a new room
 */
router.post('/', authenticate, roomCreationLimiter, validateRoomCreation, async (req, res) => {
  try {
    console.log('[DEBUG] Create room request body:', req.body);
    console.log('[DEBUG] User:', req.user);
    const userId = parseInt(req.user.user_id);
    const room = await createRoom(userId, req.body);

    await logRoomEvent(
      userId,
      room.room_id,
      'create',
      { roomCode: room.room_code }
    );

    res.status(201).json({
      success: true,
      room: {
        roomId: room.room_id.toString(),
        roomCode: room.room_code,
        roomName: room.room_name,
        maxMembers: room.max_members,
        isPublic: room.is_public,
        requiresApproval: room.requires_approval,
        createdAt: room.created_at
      }
    });
  } catch (error) {
    console.error('Create room error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to create room',
      message: error.message
    });
  }
});

/**
 * POST /api/rooms/join
 * Join a room by code
 */
router.post('/join', authenticate, validateRoomJoin, async (req, res) => {
  try {
    const { roomCode } = req.body;
    const result = await joinRoom(parseInt(req.user.user_id), roomCode);

    if (!result.success) {
      return res.status(400).json(result);
    }

    if (result.joined) {
      await logRoomEvent(
        parseInt(req.user.user_id),
        result.room.room_id,
        'join',
        { roomCode }
      );
    }

    // Format response based on whether user joined or is waiting for approval
    if (result.joined && result.room) {
      res.json({
        success: true,
        joined: true,
        requiresApproval: false,
        room: {
          roomId: result.room.room_id.toString(),
          roomCode: result.room.room_code,
          roomName: result.room.room_name,
          maxMembers: result.room.max_members,
          isPublic: result.room.is_public,
          requiresApproval: result.room.requires_approval,
          isActive: result.room.is_active,
          host: result.room.host ? {
            userId: result.room.host.user_id.toString(),
            displayName: result.room.host.display_name,
            avatarUrl: result.room.host.avatar_url
          } : undefined,
          members: result.room.members ? result.room.members.map(m => ({
            userId: m.user.user_id.toString(),
            displayName: m.user.display_name,
            avatarUrl: m.user.avatar_url,
            role: m.role,
            isOnline: m.is_online,
            joinedAt: m.joined_at
          })) : [],
          memberCount: result.room.members ? result.room.members.length : 0,
          createdAt: result.room.created_at
        }
      });
    } else {
      // Waiting for approval or other status
      res.json({
        success: true,
        ...result
      });
    }
  } catch (error) {
    console.error('Join room error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to join room',
      message: error.message
    });
  }
});

/**
 * POST /api/rooms/:roomId/leave
 * Leave a room
 */
router.post('/:roomId/leave', authenticate, validateRoomVisit, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { timeSpentSeconds } = req.body;

    const result = await leaveRoom(parseInt(req.user.user_id), roomId, timeSpentSeconds);

    if (!result.success) {
      return res.status(400).json(result);
    }

    await logRoomEvent(
      parseInt(req.user.user_id),
      roomId,
      'leave',
      { timeSpentSeconds }
    );

    res.json(result);
  } catch (error) {
    console.error('Leave room error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to leave room',
      message: error.message
    });
  }
});

/**
 * GET /api/rooms/code/:roomCode
 * Get room details by code
 */
router.get('/code/:roomCode', authenticate, async (req, res) => {
  try {
    const { roomCode } = req.params;
    const room = await getRoomByCode(roomCode);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }

    res.json({
      success: true,
      room: {
        roomId: room.room_id.toString(),
        roomCode: room.room_code,
        roomName: room.room_name,
        maxMembers: room.max_members,
        isPublic: room.is_public,
        requiresApproval: room.requires_approval,
        isActive: room.is_active,
        host: {
          userId: room.host.user_id.toString(),
          displayName: room.host.display_name,
          avatarUrl: room.host.avatar_url
        },
        members: room.members.map(m => ({
          userId: m.user.user_id.toString(),
          displayName: m.user.display_name,
          avatarUrl: m.user.avatar_url,
          role: m.role,
          isOnline: m.is_online,
          joinedAt: m.joined_at
        })),
        memberCount: room.members.length,
        createdAt: room.created_at
      }
    });
  } catch (error) {
    console.error('Get room error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch room',
      message: error.message
    });
  }
});

/**
 * GET /api/rooms/:roomId
 * Get room details by ID
 */
router.get('/:roomId', authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = await getRoomById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }

    res.json({
      success: true,
      room: {
        roomId: room.room_id.toString(),
        roomCode: room.room_code,
        roomName: room.room_name,
        maxMembers: room.max_members,
        isPublic: room.is_public,
        requiresApproval: room.requires_approval,
        isActive: room.is_active,
        host: {
          userId: room.host.user_id.toString(),
          displayName: room.host.display_name,
          avatarUrl: room.host.avatar_url
        },
        members: room.members.map(m => ({
          userId: m.user.user_id.toString(),
          displayName: m.user.display_name,
          avatarUrl: m.user.avatar_url,
          role: m.role,
          isOnline: m.is_online,
          joinedAt: m.joined_at
        })),
        memberCount: room.members.length,
        createdAt: room.created_at
      }
    });
  } catch (error) {
    console.error('Get room error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch room',
      message: error.message
    });
  }
});

/**
 * GET /api/rooms/:roomId/pending-requests
 * Get pending join requests (host only)
 */
router.get('/:roomId/pending-requests', authenticate, isRoomHost, async (req, res) => {
  try {
    const { roomId } = req.params;
    const requests = await getPendingRequests(roomId, parseInt(req.user.user_id));

    res.json({
      success: true,
      requests: requests.map(r => ({
        requestId: r.request_id.toString(),
        user: {
          userId: r.user.user_id.toString(),
          displayName: r.user.display_name,
          avatarUrl: r.user.avatar_url
        },
        requestedAt: r.requested_at,
        expiresAt: r.expires_at
      }))
    });
  } catch (error) {
    console.error('Get pending requests error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch pending requests',
      message: error.message
    });
  }
});

/**
 * POST /api/rooms/join-requests/:requestId/approve
 * Approve or reject join request (host only)
 */
router.post('/join-requests/:requestId/approve', authenticate, validateJoinApproval, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { approved } = req.body;

    const result = await handleJoinRequest(requestId, approved, parseInt(req.user.user_id));

    if (!result.success) {
      return res.status(400).json(result);
    }

    await logRoomEvent(
      parseInt(req.user.user_id),
      null,
      approved ? 'approve_request' : 'reject_request',
      { requestId }
    );

    res.json(result);
  } catch (error) {
    console.error('Handle join request error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to process join request',
      message: error.message
    });
  }
});

/**
 * GET /api/rooms/suggested
 * Get suggested rooms for user
 */
router.get('/user/suggested', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const userId = parseInt(req.user.user_id);
    const rooms = await getSuggestedRooms(userId, limit);

    res.json({
      success: true,
      rooms: rooms.map(r => ({
        roomId: r.roomId.toString(),
        roomCode: r.roomCode,
        roomName: r.roomName,
        hostUserId: r.hostUserId.toString(),
        maxMembers: r.maxMembers,
        isPublic: r.isPublic,
        requiresApproval: r.requiresApproval,
        createdAt: r.createdAt,
        host: r.host,
        memberCount: r.memberCount,
        visitInfo: r.visitInfo
      }))
    });
  } catch (error) {
    console.error('Get suggested rooms error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch suggested rooms',
      message: error.message
    });
  }
});

/**
 * POST /api/rooms/:roomId/favorite
 * Toggle favorite status for a room
 */
router.post('/:roomId/favorite', authenticate, validateFavoriteToggle, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { isFavorite } = req.body;

    const result = await toggleFavorite(parseInt(req.user.user_id), roomId, isFavorite);

    res.json(result);
  } catch (error) {
    console.error('Toggle favorite error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to update favorite status',
      message: error.message
    });
  }
});

module.exports = router;
