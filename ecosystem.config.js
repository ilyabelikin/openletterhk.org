const root = '/var/www/openletterhk.org';

module.exports = {
  apps: [
    {
      name: 'openletterhk',
      script: `${root}/server.js`,
      interpreter: '/opt/node22/bin/node', // -> current Node 22.x (symlink, so patches need no config change)
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
