const crypto = require('crypto');
const { SESSION_TTL_MS } = require('./config');
const { readJSON, writeJSON, USERS_FILE } = require('./storage');

// Sessions with TTL to prevent memory leaks
const SESSIONS = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of SESSIONS) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      SESSIONS.delete(token);
    }
  }
}

// Clean up expired sessions every 10 minutes
setInterval(cleanupExpiredSessions, 10 * 60 * 1000).unref();

function createSession(user) {
  const token = generateToken();
  SESSIONS.set(token, {
    username: user.username,
    role: user.role,
    id: user.id,
    createdAt: Date.now()
  });
  return token;
}

function destroySession(token) {
  if (token) SESSIONS.delete(token);
}

function getSession(token) {
  const session = SESSIONS.get(token);
  if (!session) return null;
  // Check TTL on access
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    SESSIONS.delete(token);
    return null;
  }
  return session;
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please login.' });
  }
  req.user = session;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }
  next();
}

async function loginUser(username, password) {
  const users = await readJSON(USERS_FILE);
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return null;
  return user;
}

module.exports = {
  SESSIONS, createSession, destroySession, getSession,
  requireAuth, requireAdmin, loginUser
};