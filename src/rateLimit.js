const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX } = require('./config');

// Simple in-memory rate limiter
const requestCounts = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  const entry = requestCounts.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    requestCounts.set(ip, { count: 1, windowStart: now });
    return next();
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
  }
  
  entry.count++;
  next();
}

// Clean up rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of requestCounts) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      requestCounts.delete(ip);
    }
  }
  // Prevent unbounded growth
  if (requestCounts.size > 10000) {
    requestCounts.clear();
  }
}, 5 * 60 * 1000).unref();

module.exports = { rateLimit };