const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { SESSION_TTL_MS, DATA_DIR } = require('./config');
const { readJSON, writeJSON, USERS_FILE } = require('./storage');

const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSIONS = new Map();

function persistSessions() {
  const obj = {};
  for (const [token, session] of SESSIONS) obj[token] = session;
  try { fs.writeJsonSync(SESSIONS_FILE, obj); } catch {}
}

function loadSessions() {
  try {
    const raw = fs.readJsonSync(SESSIONS_FILE);
    const now = Date.now();
    Object.entries(raw || {}).forEach(([token, session]) => {
      if (session && now - session.createdAt <= SESSION_TTL_MS) SESSIONS.set(token, session);
    });
  } catch {}
}

loadSessions();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function cleanupExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [token, session] of SESSIONS) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      SESSIONS.delete(token);
      changed = true;
    }
  }
  if (changed) persistSessions();
}

setInterval(cleanupExpiredSessions, 10 * 60 * 1000).unref();

function createSession(user) {
  const token = generateToken();
  SESSIONS.set(token, {
    username: user.username,
    role: user.role,
    id: user.id,
    createdAt: Date.now()
  });
  persistSessions();
  return token;
}

function destroySession(token) {
  if (token) SESSIONS.delete(token);
  persistSessions();
}

function getSession(token) {
  const session = SESSIONS.get(token);
  if (!session) return null;
  // Check TTL on access
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    SESSIONS.delete(token);
    persistSessions();
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