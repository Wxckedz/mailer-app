module.exports = {
  apps: [{
    name: 'mailer-app',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '700M',
    node_args: '--max-old-space-size=512 --expose-gc',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // Restart on crash with exponential backoff
    exp_backoff_restart_delay: 100,
    // Log rotation
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    merge_logs: true,
    time: true,
    // Kill timeout
    kill_timeout: 10000,
    // Restart delay
    restart_delay: 3000,
    // Max restarts in 1 hour
    max_restarts: 10,
    // Graceful shutdown
    shutdown_with_message: true
  }]
};