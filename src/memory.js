const { MEMORY_WARN_MB, MEMORY_CRITICAL_MB } = require('./config');

let lastMemoryLog = 0;

function getMemoryUsageMB() {
  const mem = process.memoryUsage();
  return {
    rss: Math.round(mem.rss / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    external: Math.round(mem.external / 1024 / 1024),
  };
}

function checkMemory() {
  const { rss } = getMemoryUsageMB();
  const now = Date.now();

  // Log memory usage every 5 minutes
  if (now - lastMemoryLog > 5 * 60 * 1000) {
    lastMemoryLog = now;
    const mem = getMemoryUsageMB();
    console.log(`📊 Memory: RSS=${mem.rss}MB Heap=${mem.heapUsed}/${mem.heapTotal}MB External=${mem.external}MB`);
  }

  if (rss > MEMORY_CRITICAL_MB) {
    console.error(`🚨 CRITICAL: Memory usage ${rss}MB exceeds ${MEMORY_CRITICAL_MB}MB. Attempting GC...`);
    if (global.gc) {
      global.gc();
      console.log('✅ Garbage collection triggered');
    }
  } else if (rss > MEMORY_WARN_MB) {
    console.warn(`⚠️ WARNING: Memory usage ${rss}MB exceeds ${MEMORY_WARN_MB}MB`);
  }

  return rss;
}

// Check memory every 30 seconds
setInterval(checkMemory, 30 * 1000).unref();

// ============ GLOBAL ERROR HANDLERS ============
function setupErrorHandlers(app) {
  // 404 handler for API routes
  app.use('/api', (req, res) => {
    res.status(404).json({ success: false, message: 'API endpoint not found' });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err.message);
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ success: false, message: 'Request body too large' });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, message: 'Invalid JSON body' });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  });

  // Unhandled promise rejections - log but don't crash
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
  });

  // Uncaught exceptions - log and attempt graceful recovery
  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  setTimeout(() => {
    console.log('💀 Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();

  // Close server
  if (global.__server) {
    global.__server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

module.exports = {
  getMemoryUsageMB, checkMemory, setupErrorHandlers, gracefulShutdown
};