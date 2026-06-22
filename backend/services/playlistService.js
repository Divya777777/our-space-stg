const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Create a new playlist
 */
async function createPlaylist(userId, playlistData) {
  try {
    const { roomId, playlistName, playlistType = 'room' } = playlistData;

    // Check if user is a member of the room
    const membership = await prisma.room_members.findFirst({
      where: {
        room_id: roomId,
        user_id: userId,
        left_at: null
      }
    });

    if (!membership) {
      return { success: false, error: 'You must be a room member to create playlists' };
    }

    const playlist = await prisma.playlists.create({
      data: {
        room_id: roomId,
        created_by_user_id: userId,
        playlist_name: playlistName,
        playlist_type: playlistType,
        is_default: false,
        is_active: true
      }
    });

    return { success: true, playlist };
  } catch (error) {
    console.error('Create playlist error:', error);
    throw new Error('Failed to create playlist');
  }
}

/**
 * Get playlists for a room (both room playlists and user's personal playlists)
 */
async function getRoomPlaylists(roomId, userId) {
  try {
    // Fetch room playlists for this specific room
    const roomPlaylists = await prisma.playlists.findMany({
      where: {
        room_id: roomId,
        playlist_type: 'room',
        is_active: true
      },
      include: {
        creator: {
          select: {
            user_id: true,
            display_name: true,
            avatar_url: true
          }
        },
        songs: {
          include: {
            song: true
          },
          orderBy: {
            position: 'asc'
          }
        }
      },
      orderBy: [
        { is_default: 'desc' },
        { created_at: 'asc' }
      ]
    });

    // Fetch user's personal playlists from ALL rooms
    const personalPlaylists = userId ? await prisma.playlists.findMany({
      where: {
        created_by_user_id: userId,
        playlist_type: 'personal',
        is_active: true
      },
      include: {
        creator: {
          select: {
            user_id: true,
            display_name: true,
            avatar_url: true
          }
        },
        songs: {
          include: {
            song: true
          },
          orderBy: {
            position: 'asc'
          }
        }
      },
      orderBy: {
        created_at: 'asc'
      }
    }) : [];

    // Combine both types of playlists
    const allPlaylists = [...roomPlaylists, ...personalPlaylists];

    return allPlaylists.map(p => ({
      playlistId: p.playlist_id.toString(),
      roomId: p.room_id.toString(),
      playlistName: p.playlist_name,
      playlistType: p.playlist_type,
      isDefault: p.is_default,
      creator: {
        userId: p.creator.user_id.toString(),
        displayName: p.creator.display_name,
        avatarUrl: p.creator.avatar_url
      },
      songs: p.songs.map(ps => ({
        playlistSongId: ps.playlist_song_id.toString(),
        songId: ps.song.song_id.toString(),
        videoId: ps.song.video_id,
        title: ps.song.title,
        artist: ps.song.artist,
        durationSeconds: ps.song.duration_seconds,
        thumbnailUrl: ps.song.thumbnail_url,
        platform: ps.song.platform,
        position: ps.position,
        addedAt: ps.added_at
      })),
      createdAt: p.created_at,
      updatedAt: p.updated_at
    }));
  } catch (error) {
    console.error('Get room playlists error:', error);
    throw new Error('Failed to fetch playlists');
  }
}

/**
 * Add song to playlist
 */
async function addSongToPlaylist(playlistId, userId, songData) {
  try {
    const { videoId, title, artist, durationSeconds, thumbnailUrl, platform = 'youtube' } = songData;

    // Check if user has permission to add songs
    const playlist = await prisma.playlists.findUnique({
      where: { playlist_id: playlistId },
      include: {
        room: {
          include: {
            members: {
              where: {
                user_id: userId,
                left_at: null
              }
            }
          }
        }
      }
    });

    if (!playlist) {
      return { success: false, error: 'Playlist not found' };
    }

    if (playlist.room.members.length === 0) {
      return { success: false, error: 'You must be a room member to add songs' };
    }

    // Check if song already exists
    let song = await prisma.songs.findUnique({
      where: { video_id: videoId }
    });

    // Create song if it doesn't exist
    if (!song) {
      song = await prisma.songs.create({
        data: {
          video_id: videoId,
          title,
          artist,
          duration_seconds: durationSeconds,
          thumbnail_url: thumbnailUrl,
          platform
        }
      });
    }

    // Check if song is already in playlist
    const existingPlaylistSong = await prisma.playlist_songs.findFirst({
      where: {
        playlist_id: playlistId,
        song_id: song.song_id
      }
    });

    if (existingPlaylistSong) {
      return { success: false, error: 'Song already in playlist' };
    }

    // Get next position
    const lastSong = await prisma.playlist_songs.findFirst({
      where: { playlist_id: playlistId },
      orderBy: { position: 'desc' }
    });

    const nextPosition = lastSong ? lastSong.position + 1 : 0;

    // Add song to playlist
    const playlistSong = await prisma.playlist_songs.create({
      data: {
        playlist_id: playlistId,
        song_id: song.song_id,
        added_by_user_id: userId,
        position: nextPosition
      },
      include: {
        song: true
      }
    });

    return {
      success: true,
      playlistSong: {
        playlistSongId: playlistSong.playlist_song_id.toString(),
        songId: playlistSong.song.song_id.toString(),
        videoId: playlistSong.song.video_id,
        title: playlistSong.song.title,
        artist: playlistSong.song.artist,
        durationSeconds: playlistSong.song.duration_seconds,
        thumbnailUrl: playlistSong.song.thumbnail_url,
        position: playlistSong.position
      }
    };
  } catch (error) {
    console.error('Add song error:', error);
    throw new Error('Failed to add song to playlist');
  }
}

/**
 * Remove song from playlist
 */
async function removeSongFromPlaylist(playlistSongId, userId) {
  try {
    const playlistSong = await prisma.playlist_songs.findUnique({
      where: { playlist_song_id: playlistSongId },
      include: {
        playlist: {
          include: {
            room: {
              include: {
                members: {
                  where: {
                    user_id: userId,
                    left_at: null
                  }
                },
                host: true
              }
            }
          }
        }
      }
    });

    if (!playlistSong) {
      return { success: false, error: 'Song not found in playlist' };
    }

    // Check if user is room member or host
    const isMember = playlistSong.playlist.room.members.length > 0;
    const isHost = playlistSong.playlist.room.host.user_id === userId;

    if (!isMember && !isHost) {
      return { success: false, error: 'You must be a room member to remove songs' };
    }

    // Delete playlist song
    await prisma.playlist_songs.delete({
      where: { playlist_song_id: playlistSongId }
    });

    return { success: true };
  } catch (error) {
    console.error('Remove song error:', error);
    throw new Error('Failed to remove song from playlist');
  }
}

/**
 * Update now playing for a room
 */
async function updateNowPlaying(roomId, userId, nowPlayingData) {
  try {
    const { videoId, playlistId, currentTimeSeconds, isPlaying = true } = nowPlayingData;

    // Check if user is a member
    const membership = await prisma.room_members.findFirst({
      where: {
        room_id: roomId,
        user_id: userId,
        left_at: null
      }
    });

    if (!membership) {
      return { success: false, error: 'You must be a room member' };
    }

    // Delete existing now playing for this room
    await prisma.now_playing.deleteMany({
      where: { room_id: roomId }
    });

    // Create new now playing entry
    const nowPlaying = await prisma.now_playing.create({
      data: {
        room_id: roomId,
        playlist_id: playlistId ? playlistId : null,
        video_id: videoId,
        current_time_seconds: currentTimeSeconds || 0,
        is_playing: isPlaying,
        controlled_by_user_id: userId
      }
    });

    // Record in playback history
    const song = await prisma.songs.findUnique({
      where: { video_id: videoId }
    });

    if (song) {
      // Check if already played recently (within last hour)
      const recentPlay = await prisma.playback_history.findFirst({
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
        await prisma.playback_history.update({
          where: { history_id: recentPlay.history_id },
          data: {
            play_count: { increment: 1 },
            played_at: new Date()
          }
        });
      } else {
        // Create new history entry
        await prisma.playback_history.create({
          data: {
            song_id: song.song_id,
            room_id: roomId,
            play_count: 1
          }
        });
      }
    }

    return { success: true, nowPlaying };
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
            playlist_name: true
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
      playlist: nowPlaying.playlist ? {
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

/**
 * Reorder songs in playlist
 */
async function reorderPlaylist(playlistId, userId, songOrder) {
  try {
    // songOrder is an array of { playlistSongId, newPosition }

    // Check permission
    const playlist = await prisma.playlists.findUnique({
      where: { playlist_id: playlistId },
      include: {
        room: {
          include: {
            members: {
              where: {
                user_id: userId,
                left_at: null
              }
            }
          }
        }
      }
    });

    if (!playlist || playlist.room.members.length === 0) {
      return { success: false, error: 'Unauthorized' };
    }

    // Update positions
    for (const item of songOrder) {
      await prisma.playlist_songs.update({
        where: { playlist_song_id: item.playlistSongId },
        data: { position: item.newPosition }
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Reorder playlist error:', error);
    throw new Error('Failed to reorder playlist');
  }
}

module.exports = {
  createPlaylist,
  getRoomPlaylists,
  addSongToPlaylist,
  removeSongFromPlaylist,
  updateNowPlaying,
  getNowPlaying,
  getPlaybackHistory,
  reorderPlaylist
};
