const { positiveId } = require('../utils/ids');

// Injecting the client lets permission and transaction behavior be tested without a live database.
function createPlaylistService(prisma) {
const failure = (error, status = 403) => ({ success: false, error, status });
const includeSongs = {
  creator: { select: { user_id: true, display_name: true, avatar_url: true } },
  songs: { include: { song: true }, orderBy: [{ position: 'asc' }, { playlist_song_id: 'asc' }] }
};
const accessInclude = userId => ({ room: { include: {
  members: { where: { user_id: userId, left_at: null } }
} } });
function canEdit(playlist, userId) {
  if (!playlist?.is_active) return false;
  if (playlist.playlist_type === 'personal') return playlist.created_by_user_id === userId;
  return playlist.playlist_type === 'room' && playlist.room?.is_active && playlist.room.members.length > 0;
}
function serializePlaylist(p) {
  return {
    playlistId: String(p.playlist_id), roomId: p.room_id == null ? null : String(p.room_id),
    playlistName: p.playlist_name, playlistType: p.playlist_type, isDefault: p.is_default,
    creator: { userId: String(p.creator.user_id), displayName: p.creator.display_name, avatarUrl: p.creator.avatar_url },
    songs: p.songs.map(ps => ({
      playlistSongId: String(ps.playlist_song_id), songId: String(ps.song_id),
      videoId: ps.song.video_id, title: ps.song.title, artist: ps.song.artist,
      durationSeconds: ps.song.duration_seconds, thumbnailUrl: ps.song.thumbnail_url,
      platform: ps.song.platform, position: ps.position, addedAt: ps.added_at
    })), createdAt: p.created_at, updatedAt: p.updated_at
  };
}
async function transaction(work) {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: 'Serializable' }); }
    catch (error) { if (error.code !== 'P2034' || attempt >= 2) throw error; }
  }
}
async function createPlaylist(userId, { roomId, playlistName, playlistType = 'room' }) {
  if (!['personal', 'room'].includes(playlistType)) return failure('Invalid playlist type', 400);
  if (typeof playlistName !== 'string' || !playlistName.trim() || playlistName.trim().length > 200) return failure('Invalid playlist name', 400);
  const room = playlistType === 'room' ? positiveId(roomId) : null;
  if (playlistType === 'room' && !room) return failure('A valid room ID is required', 400);
  return transaction(async tx => {
    if (playlistType === 'room') {
      const member = await tx.room_members.findFirst({ where: { room_id: room, user_id: userId, left_at: null, room: { is_active: true } } });
      if (!member) return failure('You must be a room member to create room playlists');
    }
    const playlist = await tx.playlists.create({ data: {
      room_id: room, created_by_user_id: userId, playlist_name: playlistName.trim(),
      playlist_type: playlistType, is_default: false, is_active: true
    } });
    return { success: true, playlist };
  });
}
async function getPersonalPlaylists(userId) {
  const lists = await prisma.playlists.findMany({
    where: { created_by_user_id: userId, playlist_type: 'personal', is_active: true },
    include: includeSongs, orderBy: { created_at: 'asc' }
  });
  return lists.map(serializePlaylist);
}
async function getRoomPlaylists(roomId, userId) {
  const member = await prisma.room_members.findFirst({ where: { room_id: roomId, user_id: userId, left_at: null, room: { is_active: true } } });
  if (!member) throw Object.assign(new Error('Room membership required'), { status: 403 });
  const lists = await prisma.playlists.findMany({
    where: { room_id: roomId, playlist_type: 'room', is_active: true },
    include: includeSongs, orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }]
  });
  return lists.map(serializePlaylist);
}
async function addSongToPlaylist(playlistId, userId, songData) {
  try {
    return await transaction(async tx => {
      const playlist = await tx.playlists.findUnique({ where: { playlist_id: playlistId }, include: accessInclude(userId) });
      if (!canEdit(playlist, userId)) return failure('Playlist unavailable or access denied');
      const { videoId, title, artist, durationSeconds, thumbnailUrl, platform = 'youtube' } = songData;
      const song = await tx.songs.upsert({ where: { video_id: videoId }, update: {}, create: {
        video_id: videoId, title, artist, duration_seconds: durationSeconds ?? 0,
        thumbnail_url: thumbnailUrl, platform
      } });
      const existing = await tx.playlist_songs.findFirst({ where: { playlist_id: playlistId, song_id: song.song_id } });
      if (existing) return failure('Song already in playlist', 409);
      const last = await tx.playlist_songs.findFirst({ where: { playlist_id: playlistId }, orderBy: { position: 'desc' } });
      const ps = await tx.playlist_songs.create({ data: {
        playlist_id: playlistId, song_id: song.song_id, added_by_user_id: userId, position: (last?.position ?? -1) + 1
      } });
      return { success: true, playlistSong: {
        playlistSongId: String(ps.playlist_song_id), songId: String(song.song_id), videoId: song.video_id,
        title: song.title, artist: song.artist, durationSeconds: song.duration_seconds,
        thumbnailUrl: song.thumbnail_url, position: ps.position
      } };
    });
  } catch (error) {
    if (error.code === 'P2002') return failure('Song already in playlist', 409);
    throw error;
  }
}
async function removeSongFromPlaylist(playlistSongId, userId) {
  return transaction(async tx => {
    const item = await tx.playlist_songs.findUnique({ where: { playlist_song_id: playlistSongId }, include: { playlist: { include: accessInclude(userId) } } });
    if (!item || !canEdit(item.playlist, userId)) return failure('Playlist unavailable or access denied');
    await tx.playlist_songs.delete({ where: { playlist_song_id: playlistSongId } });
    return { success: true };
  });
}
async function reorderPlaylist(playlistId, userId, songOrder) {
  if (!Array.isArray(songOrder) || songOrder.length > 1000) return failure('Invalid song order', 400);
  const normalized = songOrder.map(item => ({ id: positiveId(item?.playlistSongId), position: item?.newPosition }));
  if (normalized.some(item => !item.id || !Number.isInteger(item.position) || item.position < 0) ||
      new Set(normalized.map(item => item.id)).size !== normalized.length ||
      new Set(normalized.map(item => item.position)).size !== normalized.length) return failure('Invalid or duplicate song positions', 400);
  return transaction(async tx => {
    const playlist = await tx.playlists.findUnique({ where: { playlist_id: playlistId }, include: accessInclude(userId) });
    if (!canEdit(playlist, userId)) return failure('Playlist unavailable or access denied');
    const items = await tx.playlist_songs.findMany({ where: { playlist_id: playlistId }, select: { playlist_song_id: true } });
    const ids = new Set(items.map(item => item.playlist_song_id));
    if (items.length !== normalized.length || normalized.some(item => !ids.has(item.id) || item.position >= items.length)) {
      return failure('Provide every song from this playlist exactly once, with positions 0 through length minus one', 400);
    }
    for (const item of normalized) {
      await tx.playlist_songs.updateMany({ where: { playlist_song_id: item.id, playlist_id: playlistId }, data: { position: item.position } });
    }
    return { success: true };
  });
}
/**
 * Update now playing for a room
 */
async function updateNowPlaying(roomId, userId, nowPlayingData) {
  try {
    return await transaction(async tx => {
    const { videoId, playlistId, currentTimeSeconds, isPlaying = true } = nowPlayingData;

    // Check if user is a member
    const membership = await tx.room_members.findFirst({
      where: {
        room_id: roomId,
        user_id: userId,
        left_at: null
      }
    });

    if (!membership) {
      return { success: false, error: 'You must be a room member' };
    }

    let sharedPlaylistId = null;
    if (playlistId != null) {
      const selected = await tx.playlists.findUnique({ where: { playlist_id: playlistId }, include: accessInclude(userId) });
      if (!canEdit(selected, userId) || (selected.playlist_type === 'room' && selected.room_id !== roomId)) {
        return failure('Playlist unavailable in this room');
      }
      // Share the selected video, not the name/identity of a private playlist.
      if (selected.playlist_type === 'room') sharedPlaylistId = playlistId;
    }

    // Delete existing now playing for this room
    await tx.now_playing.deleteMany({
      where: { room_id: roomId }
    });

    // Create new now playing entry
    const nowPlaying = await tx.now_playing.create({
      data: {
        room_id: roomId,
        playlist_id: sharedPlaylistId,
        video_id: videoId,
        current_time_seconds: currentTimeSeconds || 0,
        is_playing: isPlaying,
        controlled_by_user_id: userId
      }
    });

    // Record in playback history
    const song = await tx.songs.findUnique({
      where: { video_id: videoId }
    });

    if (song) {
      // Check if already played recently (within last hour)
      const recentPlay = await tx.playback_history.findFirst({
        where: {
          song_id: song.song_id,
          room_id: roomId,
          played_at: {
            gte: new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
          }
        }
      });

      if (recentPlay) {
        // Update play count
        await tx.playback_history.update({
          where: { history_id: recentPlay.history_id },
          data: {
            play_count: { increment: 1 },
            played_at: new Date()
          }
        });
      } else {
        // Create new history entry
        await tx.playback_history.create({
          data: {
            song_id: song.song_id,
            room_id: roomId,
            play_count: 1
          }
        });
      }
    }

    return { success: true, nowPlaying };
    });
  } catch (error) {
    console.error('Update now playing error:', error);
    throw new Error('Failed to update now playing');
  }
}

/**
 * Get current now playing for a room
 */
async function getNowPlaying(roomId) {
  try {
    const nowPlaying = await prisma.now_playing.findFirst({
      where: { room_id: roomId },
      include: {
        playlist: {
          select: {
            playlist_id: true,
            playlist_name: true,
            playlist_type: true
          }
        }
      },
      orderBy: {
        started_at: 'desc'
      }
    });

    if (!nowPlaying) {
      return null;
    }

    // Get song details
    const song = await prisma.songs.findUnique({
      where: { video_id: nowPlaying.video_id }
    });

    return {
      nowPlayingId: nowPlaying.now_playing_id.toString(),
      roomId: nowPlaying.room_id.toString(),
      videoId: nowPlaying.video_id,
      playlist: nowPlaying.playlist?.playlist_type === 'room' ? {
        playlistId: nowPlaying.playlist.playlist_id.toString(),
        playlistName: nowPlaying.playlist.playlist_name
      } : null,
      song: song ? {
        songId: song.song_id.toString(),
        title: song.title,
        artist: song.artist,
        durationSeconds: song.duration_seconds,
        thumbnailUrl: song.thumbnail_url
      } : null,
      currentTimeSeconds: nowPlaying.current_time_seconds,
      isPlaying: nowPlaying.is_playing,
      startedAt: nowPlaying.started_at
    };
  } catch (error) {
    console.error('Get now playing error:', error);
    throw new Error('Failed to fetch now playing');
  }
}

/**
 * Get playback history for a room
 */
async function getPlaybackHistory(roomId, limit = 50) {
  try {
    const history = await prisma.playback_history.findMany({
      where: { room_id: roomId },
      include: {
        song: true
      },
      orderBy: {
        played_at: 'desc'
      },
      take: limit
    });

    return history.map(h => ({
      historyId: h.history_id.toString(),
      song: {
        songId: h.song.song_id.toString(),
        videoId: h.song.video_id,
        title: h.song.title,
        artist: h.song.artist,
        durationSeconds: h.song.duration_seconds,
        thumbnailUrl: h.song.thumbnail_url
      },
      playCount: h.play_count,
      playedAt: h.played_at
    }));
  } catch (error) {
    console.error('Get playback history error:', error);
    throw new Error('Failed to fetch playback history');
  }
}

return { createPlaylist, getPersonalPlaylists, getRoomPlaylists, addSongToPlaylist,
  removeSongFromPlaylist, reorderPlaylist, updateNowPlaying, getNowPlaying, getPlaybackHistory };
}

// Lazy default client keeps factory-only tests independent of generated Prisma code.
let service;
const methods = ['createPlaylist', 'getPersonalPlaylists', 'getRoomPlaylists', 'addSongToPlaylist',
  'removeSongFromPlaylist', 'reorderPlaylist', 'updateNowPlaying', 'getNowPlaying', 'getPlaybackHistory'];
module.exports = { createPlaylistService };
for (const method of methods) module.exports[method] = (...args) => {
  service ||= createPlaylistService(new (require('@prisma/client').PrismaClient)());
  return service[method](...args);
};
