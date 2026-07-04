// api.js - Frontend API Client for Our Space
class OurSpaceAPI {
  constructor() {
    // Automatically use the correct backend URL based on environment
    const hostname = window.location.hostname;

    // Production: GitHub Pages deployment
    if (hostname === 'divya777777.github.io') {
      this.baseURL = 'https://our-space-production-30ee.up.railway.app/api';
    }
    // Development: localhost or IP address
    else {
      this.baseURL = `http://${hostname}:3001/api`;
    }

    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  /**
   * Make authenticated API request
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    // Add authorization header if token exists
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      // Handle token expiration
      if (response.status === 401 && this.refreshToken) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          // Retry original request with new token
          headers['Authorization'] = `Bearer ${this.accessToken}`;
          const retryResponse = await fetch(url, { ...options, headers });
          return await retryResponse.json();
        }
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Request failed');
      }

      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * Set access token
   */
  setToken(accessToken, refreshToken = null) {
    this.accessToken = accessToken;
    localStorage.setItem('accessToken', accessToken);

    if (refreshToken) {
      this.refreshToken = refreshToken;
      localStorage.setItem('refreshToken', refreshToken);
    }
  }

  /**
   * Clear tokens
   */
  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken() {
    try {
      const response = await fetch(`${this.baseURL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken })
      });

      if (!response.ok) {
        this.clearTokens();
        return false;
      }

      const data = await response.json();
      this.setToken(data.accessToken);
      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      this.clearTokens();
      return false;
    }
  }

  // ==================
  // Authentication
  // ==================

  async loginWithGoogle(credential) {
    const data = await this.request('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential })
    });

    if (data.success) {
      this.setToken(data.accessToken, data.refreshToken);
    }

    return data;
  }

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.clearTokens();
    }
  }

  async verifyToken() {
    return await this.request('/auth/verify');
  }

  // ==================
  // Rooms
  // ==================

  async createRoom(roomData) {
    return await this.request('/rooms', {
      method: 'POST',
      body: JSON.stringify(roomData)
    });
  }

  async joinRoom(roomCode) {
    return await this.request('/rooms/join', {
      method: 'POST',
      body: JSON.stringify({ roomCode })
    });
  }

  async leaveRoom(roomId, timeSpentSeconds = 0) {
    return await this.request(`/rooms/${roomId}/leave`, {
      method: 'POST',
      body: JSON.stringify({ timeSpentSeconds })
    });
  }

  async getRoomByCode(roomCode) {
    return await this.request(`/rooms/code/${roomCode}`);
  }

  async getRoomById(roomId) {
    return await this.request(`/rooms/${roomId}`);
  }

  async getSuggestedRooms(limit = 5) {
    return await this.request(`/rooms/user/suggested?limit=${limit}`);
  }

  async toggleFavorite(roomId, isFavorite) {
    return await this.request(`/rooms/${roomId}/favorite`, {
      method: 'POST',
      body: JSON.stringify({ isFavorite })
    });
  }

  async getPendingRequests(roomId) {
    return await this.request(`/rooms/${roomId}/pending-requests`);
  }

  async approveJoinRequest(requestId, approved) {
    return await this.request(`/rooms/join-requests/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approved })
    });
  }

  // ==================
  // Messages
  // ==================

  async sendMessage(roomId, messageData) {
    return await this.request(`/messages/${roomId}`, {
      method: 'POST',
      body: JSON.stringify(messageData)
    });
  }

  async getRoomMessages(roomId, limit = 100, offset = 0) {
    return await this.request(`/messages/${roomId}?limit=${limit}&offset=${offset}`);
  }

  async deleteMessage(messageId) {
    return await this.request(`/messages/${messageId}`, {
      method: 'DELETE'
    });
  }

  async searchMessages(roomId, searchTerm, limit = 50) {
    return await this.request(`/messages/${roomId}/search?q=${encodeURIComponent(searchTerm)}&limit=${limit}`);
  }

  // ==================
  // Playlists
  // ==================

  async createPlaylist(roomId, playlistName, playlistType = 'room') {
    return await this.request('/playlists', {
      method: 'POST',
      body: JSON.stringify({ roomId, playlistName, playlistType })
    });
  }

  async getRoomPlaylists(roomId) {
    return await this.request(`/playlists/room/${roomId}`);
  }

  async addSongToPlaylist(playlistId, songData) {
    return await this.request(`/playlists/${playlistId}/songs`, {
      method: 'POST',
      body: JSON.stringify(songData)
    });
  }

  async removeSongFromPlaylist(playlistSongId) {
    return await this.request(`/playlists/songs/${playlistSongId}`, {
      method: 'DELETE'
    });
  }

  async updateNowPlaying(roomId, nowPlayingData) {
    return await this.request(`/playlists/room/${roomId}/now-playing`, {
      method: 'POST',
      body: JSON.stringify(nowPlayingData)
    });
  }

  async getNowPlaying(roomId) {
    return await this.request(`/playlists/room/${roomId}/now-playing`);
  }

  async getPlaybackHistory(roomId, limit = 50) {
    return await this.request(`/playlists/room/${roomId}/history?limit=${limit}`);
  }

  // ==================
  // Users
  // ==================

  async getUserProfile() {
    return await this.request('/users/me');
  }

  async updatePreferences(preferences) {
    return await this.request('/users/me/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences)
    });
  }

  async updateProfile(profileData) {
    return await this.request('/users/me/profile', {
      method: 'PUT',
      body: JSON.stringify(profileData)
    });
  }

  async getUserActivity(limit = 10) {
    return await this.request(`/users/me/activity?limit=${limit}`);
  }
}

// Create global API instance
const api = new OurSpaceAPI();
