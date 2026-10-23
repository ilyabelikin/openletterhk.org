const root = '/var/www/openletterhk.org';

module.exports = {
  apps: [
    {
      name: 'openletterhk',
      script: `${root}/server.js`,
      interpreter: '/root/.nvm/versions/node/v22.12.0/bin/node',
      cwd: root,
      // ADMIN_KEY (and any other secrets) live in .env on the server, never in git.
      node_args: `--env-file-if-exists=${root}/.env`,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3010,
        DATA_DIR: `${root}/data`,
      },
    },
  ],
};
