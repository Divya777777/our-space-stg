const express = require('express');
const router = express.Router();
const {
  createPlaylist,
  getRoomPlaylists,
  addSongToPlaylist,
  removeSongFromPlaylist,
  updateNowPlaying,
  getNowPlaying,
  getPlaybackHistory,
  reorderPlaylist
} = require('../services/playlistService');
const { authenticate, isRoomMember } = require('../middleware/auth');
const {
  validatePlaylistCreation,
  validateAddSong,
  validateNowPlaying
} = require('../middleware/validation');

/**
 * POST /api/playlists
 * Create a new playlist
 */
router.post('/', authenticate, validatePlaylistCreation, async (req, res) => {
  try {
    const result = await createPlaylist(req.user.user_id, req.body);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(201).json({
      success: true,
      playlist: {
        playlistId: result.playlist.playlist_id.toString(),
        roomId: result.playlist.room_id.toString(),
        playlistName: result.playlist.playlist_name,
        playlistType: result.playlist.playlist_type,
        isDefault: result.playlist.is_default,
        createdAt: result.playlist.created_at
      }
    });
  } catch (error) {
    console.error('Create playlist error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to create playlist',
      message: error.message
    });
  }
});

/**
 * GET /api/playlists/room/:roomId
 * Get all playlists for a room (room playlists + user's personal playlists)
 */
router.get('/room/:roomId', authenticate, isRoomMember, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const userId = parseInt(req.user.user_id);
    const playlists = await getRoomPlaylists(roomId, userId);

    res.json({
      success: true,
      playlists
    });
  } catch (error) {
    console.error('Get playlists error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch playlists',
      message: error.message
    });
  }
});

/**
 * POST /api/playlists/:playlistId/songs
 * Add a song to a playlist
 */
router.post('/:playlistId/songs', authenticate, validateAddSong, async (req, res) => {
  try {
    const playlistId = parseInt(req.params.playlistId);
    const result = await addSongToPlaylist(playlistId, req.user.user_id, req.body);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('Add song error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to add song to playlist',
      message: error.message
    });
  }
});

/**
 * DELETE /api/playlists/songs/:playlistSongId
 * Remove a song from a playlist
 */
router.delete('/songs/:playlistSongId', authenticate, async (req, res) => {
  try {
    const playlistSongId = parseInt(req.params.playlistSongId);
    const result = await removeSongFromPlaylist(playlistSongId, req.user.user_id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Remove song error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to remove song from playlist',
      message: error.message
    });
  }
});

/**
 * POST /api/playlists/room/:roomId/now-playing
 * Update now playing for a room
 */
router.post('/room/:roomId/now-playing', authenticate, isRoomMember, validateNowPlaying, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const result = await updateNowPlaying(roomId, req.user.user_id, req.body);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      nowPlaying: {
        nowPlayingId: result.nowPlaying.now_playing_id.toString(),
        roomId: result.nowPlaying.room_id.toString(),
        videoId: result.nowPlaying.video_id,
        playlistId: result.nowPlaying.playlist_id?.toString(),
        currentTimeSeconds: result.nowPlaying.current_time_seconds,
        isPlaying: result.nowPlaying.is_playing,
        startedAt: result.nowPlaying.started_at
      }
    });
  } catch (error) {
    console.error('Update now playing error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to update now playing',
      message: error.message
    });
  }
});

/**
 * GET /api/playlists/room/:roomId/now-playing
 * Get current now playing for a room
 */
router.get('/room/:roomId/now-playing', authenticate, isRoomMember, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const nowPlaying = await getNowPlaying(roomId);

    if (!nowPlaying) {
      return res.json({
        success: true,
        nowPlaying: null
      });
    }

    res.json({
      success: true,
      nowPlaying
    });
  } catch (error) {
    console.error('Get now playing error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch now playing',
      message: error.message
    });
  }
});

/**
 * GET /api/playlists/room/:roomId/history
 * Get playback history for a room
 */
router.get('/room/:roomId/history', authenticate, isRoomMember, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const limit = parseInt(req.query.limit) || 50;

    const history = await getPlaybackHistory(roomId, limit);

    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Get playback history error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch playback history',
      message: error.message
    });
  }
});

/**
 * PUT /api/playlists/:playlistId/reorder
 * Reorder songs in a playlist
 */
router.put('/:playlistId/reorder', authenticate, async (req, res) => {
  try {
    const playlistId = parseInt(req.params.playlistId);
    const { songOrder } = req.body; // Array of { playlistSongId, newPosition }

    if (!songOrder || !Array.isArray(songOrder)) {
      return res.status(400).json({
        success: false,
        error: 'songOrder array is required'
      });
    }

    const result = await reorderPlaylist(playlistId, req.user.user_id, songOrder);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Reorder playlist error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to reorder playlist',
      message: error.message
    });
  }
});

module.exports = router;
