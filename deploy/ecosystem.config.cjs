module.exports = {
  apps: [
    {
      name: "fano-labs-backend",
      cwd: "/var/www/fano-labs/current/backend",
      script: "dist/src/index.js",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: "3001"
      },
      out_file: "/var/log/fano-labs/backend-out.log",
      error_file: "/var/log/fano-labs/backend-error.log",
      merge_logs: true
    }
  ]
};
