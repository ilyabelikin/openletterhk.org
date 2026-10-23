const root = '/var/www/openletterhk.org';

module.exports = {
  apps: [
    {
      name: 'openletterhk',
      script: `${root}/server.js`,
      interpreter: '/root/.nvm/versions/node/v22.12.0/bin/node',
      cwd: root,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3010,
        DATA_DIR: `${root}/data`,
      },
    },
  ],
};
