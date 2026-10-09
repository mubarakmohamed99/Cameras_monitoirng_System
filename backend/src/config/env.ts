export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'camadmin',
    password: process.env.DB_PASS || 'camplexpass',
    database: process.env.DB_NAME || 'camerasdb',
  },

  mediamtx: {
    apiUrl: process.env.MEDIAMTX_API_URL || 'http://localhost:9997',
    apiUser: process.env.MEDIAMTX_API_USER || 'admin',
    apiPassword: process.env.MEDIAMTX_API_PASSWORD || 'admin123',
    rtspUrl: process.env.MEDIAMTX_RTSP_URL || 'rtsp://localhost:8554',
    hlsInternal: process.env.MEDIAMTX_HLS_INTERNAL || 'http://localhost:8888',
  },

  videos: {
    dir: process.env.VIDEOS_DIR || '/videos',
  },

  demo: {
    // 'external' (default): a separate demo-publisher process pushes RTSP
    // to MediaMTX — the backend never runs FFmpeg itself.
    // 'inprocess': legacy behavior, the backend spawns FFmpeg child processes.
    publisherMode: process.env.DEMO_PUBLISHER || 'external',
  },

  internal: {
    // Shared key the standalone demo publisher uses to fetch its work list.
    publisherKey: process.env.PUBLISHER_KEY || 'dev-publisher-key',
  },
});
