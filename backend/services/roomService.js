const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

/**
 * Generate unique room code
 * @returns {string} - 6-character room code
 */
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a new room
 */
async function createRoom(userId, roomData) {
  try {
    // Generate unique room code
    let roomCode = generateRoomCode();
    let attempts = 0;

    // Ensure code is unique
    while (attempts < 10) {
      const existing = await prisma.rooms.findUnique({
        where: { room_code: roomCode }
      });

      if (!existing) break;

      roomCode = generateRoomCode();
      attempts++;
    }

    // Create room
    const room = await prisma.rooms.create({
      data: {
        room_code: roomCode,
        room_name: roomData.roomName || null,
        host_user_id: userId,
        max_members: roomData.maxMembers || 10,
        is_public: roomData.isPublic || false,
        requires_approval: roomData.requiresApproval !== undefined ? roomData.requiresApproval : true,
        is_active: true,
        encryption_enabled: true
      }
    });

    // Add host as first member
    await prisma.room_members.create({
      data: {
        room_id: room.room_id,
        user_id: userId,
        role: 'host',
        is_online: true
      }
    });

    // Create default playlist for the room
    await prisma.playlists.create({
      data: {
        room_id: room.room_id,
        created_by_user_id: userId,
        playlist_name: 'Room Playlist',
        playlist_type: 'room',
        is_default: true,
        is_active: true
      }
    });

    // Record visit
    await recordVisit(userId, room.room_id);

    return room;
  } catch (error) {
    console.error('Create room error:', error);
    throw new Error('Failed to create room');
  }
}

/**
 * Get room by code
 */
async function getRoomByCode(roomCode) {
  try {
    const room = await prisma.rooms.findUnique({
      where: { room_code: roomCode.toUpperCase() },
      include: {
        host: {
          select: {
            user_id: true,
            display_name: true,
            avatar_url: true
          }
        },
        members: {
          where: { left_at: null },
          include: {
            user: {
              select: {
                user_id: true,
                display_name: true,
                avatar_url: true
              }
            }
          }
        },
        playlists: {
          where: { is_active: true }
        }
      }
    });

    return room;
  } catch (error) {
    console.error('Get room error:', error);
    throw new Error('Failed to fetch room');
  }
}

/**
 * Get room by ID
 */
async function getRoomById(roomId) {
  try {
    const room = await prisma.rooms.findUnique({
      where: { room_id: roomId },
      include: {
        host: {
          select: {
            user_id: true,
            display_name: true,
            avatar_url: true
          }
        },
        members: {
          where: { left_at: null },
          include: {
            user: {
              select: {
                user_id: true,
                display_name: true,
                avatar_url: true
              }
            }
          }
        }
      }
    });

    return room;
  } catch (error) {
    console.error('Get room by ID error:', error);
    throw new Error('Failed to fetch room');
  }
}

/**
 * Join a room
 */
async function joinRoom(userId, roomCode) {
  try {
    const room = await getRoomByCode(roomCode);

    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    if (!room.is_active) {
      return { success: false, error: 'Room is no longer active' };
    }

    // Check if already a member
    const existingMember = await prisma.room_members.findFirst({
      where: {
        room_id: room.room_id,
        user_id: userId,
        left_at: null
      }
    });

    if (existingMember) {
      // Update to online
      await prisma.room_members.update({
        where: { member_id: existingMember.member_id },
        data: { is_online: true }
      });

      await recordVisit(userId, room.room_id);

      return { success: true, room, joined: true, requiresApproval: false };
    }

    // Check capacity
    const memberCount = await prisma.room_members.count({
      where: {
        room_id: room.room_id,
        left_at: null
      }
    });

    if (memberCount >= room.max_members) {
      return { success: false, error: 'Room is full' };
    }

    // If requires approval, create join request
    if (room.requires_approval && room.host_user_id !== userId) {
      const existingRequest = await prisma.pending_join_requests.findFirst({
        where: {
          room_id: room.room_id,
          user_id: userId,
          status: 'pending'
        }
      });

      if (existingRequest) {
        return {
          success: true,
          requiresApproval: true,
          requestPending: true,
          requestId: existingRequest.request_id,
          roomId: room.room_id.toString()
        };
      }

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15 minute expiry

      const pendingRequest = await prisma.pending_join_requests.create({
        data: {
          room_id: room.room_id,
          user_id: userId,
          status: 'pending',
          expires_at: expiresAt
        }
      });

      return {
        success: true,
        requiresApproval: true,
        requestCreated: true,
        requestId: pendingRequest.request_id,
        roomId: room.room_id.toString()
      };
    }

    // Add as member
    await prisma.room_members.create({
      data: {
        room_id: room.room_id,
        user_id: userId,
        role: 'member',
        is_online: true
      }
    });

    await recordVisit(userId, room.room_id);

    return { success: true, room, joined: true, requiresApproval: false };
  } catch (error) {
    console.error('Join room error:', error);
    throw new Error('Failed to join room');
  }
}

/**
 * Leave a room
 */
async function leaveRoom(userId, roomId, timeSpentSeconds = 0) {
  try {
    const membership = await prisma.room_members.findFirst({
      where: {
        room_id: roomId,
        user_id: userId,
        left_at: null
      }
    });

    if (!membership) {
      return { success: false, error: 'Not a member of this room' };
    }

    // Update membership
    await prisma.room_members.update({
      where: { member_id: membership.member_id },
      data: {
        left_at: new Date(),
        is_online: false
      }
    });

    // Update time spent
    if (timeSpentSeconds > 0) {
      await prisma.recent_rooms.updateMany({
        where: {
          user_id: userId,
          room_id: roomId
        },
        data: {
          total_time_spent_seconds: {
            increment: timeSpentSeconds
          }
        }
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Leave room error:', error);
    throw new Error('Failed to leave room');
  }
}

/**
 * Approve or reject join request
 */
async function handleJoinRequest(requestId, approved, hostUserId) {
  try {
    const request = await prisma.pending_join_requests.findUnique({
      where: { request_id: requestId },
      include: {
        room: true
      }
    });

    if (!request) {
      return { success: false, error: 'Request not found' };
    }

    if (request.room.host_user_id !== hostUserId) {
      return { success: false, error: 'Only room host can approve requests' };
    }

    if (request.status !== 'pending') {
      return { success: false, error: 'Request already processed' };
    }

    // Update request status
    await prisma.pending_join_requests.update({
      where: { request_id: request.request_id },
      data: {
        status: approved ? 'approved' : 'rejected',
        responded_at: new Date()
      }
    });

    // If approved, add as member
    if (approved) {
      await prisma.room_members.create({
        data: {
          room_id: request.room_id,
          user_id: request.user_id,
          role: 'member',
          is_online: true
        }
      });

      await recordVisit(Number(request.user_id), Number(request.room_id));
    }

    return { success: true, approved };
  } catch (error) {
    console.error('Handle join request error:', error);
    throw new Error('Failed to process join request');
  }
}

/**
 * Get pending join requests for a room
 */
async function getPendingRequests(roomId, hostUserId) {
  try {
    const room = await prisma.rooms.findUnique({
      where: { room_id: roomId }
    });

    if (!room || room.host_user_id !== hostUserId) {
      throw new Error('Unauthorized');
    }

    const requests = await prisma.pending_join_requests.findMany({
      where: {
        room_id: roomId,
        status: 'pending',
        expires_at: {
          gt: new Date()
        }
      },
      include: {
        user: {
          select: {
            user_id: true,
            display_name: true,
            avatar_url: true
          }
        }
      },
      orderBy: {
        requested_at: 'asc'
      }
    });

    return requests;
  } catch (error) {
    console.error('Get pending requests error:', error);
    throw new Error('Failed to fetch pending requests');
  }
}

/**
 * Record room visit for recent rooms tracking
 */
async function recordVisit(userId, roomId) {
  try {
    const existing = await prisma.recent_rooms.findFirst({
      where: {
        user_id: userId,
        room_id: roomId
      }
    });

    if (existing) {
      await prisma.recent_rooms.update({
        where: { visit_id: existing.visit_id },
        data: {
          last_visited_at: new Date(),
          visit_count: { increment: 1 }
        }
      });
    } else {
      await prisma.recent_rooms.create({
        data: {
          user_id: userId,
          room_id: roomId,
          last_visited_at: new Date(),
          visit_count: 1,
          total_time_spent_seconds: 0,
          is_favorite: false
        }
      });
    }
  } catch (error) {
    console.error('Record visit error:', error);
    // Don't throw - this is not critical
  }
}

/**
 * Get suggested rooms for user
 */
async function getSuggestedRooms(userId, limit = 5) {
  try {
    const recentRooms = await prisma.recent_rooms.findMany({
      where: {
        user_id: userId
      },
      include: {
        room: {
          include: {
            host: {
              select: {
                display_name: true,
                avatar_url: true
              }
            },
            members: {
              where: { left_at: null },
              select: { user_id: true }
            }
          }
        }
      },
      orderBy: [
        { is_favorite: 'desc' },
        { last_visited_at: 'desc' },
        { visit_count: 'desc' }
      ],
      take: limit
    });

    // Filter for active rooms and format response
    return recentRooms
      .filter(r => r.room !== null && r.room.is_active)
      .map(r => ({
        roomId: r.room.room_id,
        roomCode: r.room.room_code,
        roomName: r.room.room_name,
        hostUserId: r.room.host_user_id,
        maxMembers: r.room.max_members,
        isPublic: r.room.is_public,
        requiresApproval: r.room.requires_approval,
        createdAt: r.room.created_at,
        host: r.room.host,
        memberCount: r.room.members.length,
        visitInfo: {
          lastVisited: r.last_visited_at,
          visitCount: r.visit_count,
          totalTimeSpent: r.total_time_spent_seconds,
          isFavorite: r.is_favorite
        }
      }));
  } catch (error) {
    console.error('Get suggested rooms error:', error);
    throw new Error('Failed to fetch suggested rooms');
  }
}

/**
 * Toggle favorite status
 */
async function toggleFavorite(userId, roomId, isFavorite) {
  try {
    const visit = await prisma.recent_rooms.findFirst({
      where: {
        user_id: userId,
        room_id: roomId
      }
    });

    if (visit) {
      await prisma.recent_rooms.update({
        where: { visit_id: visit.visit_id },
        data: { is_favorite: isFavorite }
      });
    } else {
      await prisma.recent_rooms.create({
        data: {
          user_id: userId,
          room_id: roomId,
          is_favorite: isFavorite,
          visit_count: 0
        }
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Toggle favorite error:', error);
    throw new Error('Failed to update favorite status');
  }
}

module.exports = {
  createRoom,
  getRoomByCode,
  getRoomById,
  joinRoom,
  leaveRoom,
  handleJoinRequest,
  getPendingRequests,
  recordVisit,
  getSuggestedRooms,
  toggleFavorite,
  generateRoomCode
};
