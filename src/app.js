const express = require('express');
const { PUBLIC_DIR, ensureDataDirs } = require('./config');
const { router } = require('./api/routes');

function createApp() {
  ensureDataDirs();

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.use('/api', router);

  // Unknown API routes -> JSON 404 (before the static handler).
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    next();
  });

  app.use(express.static(PUBLIC_DIR));

  // Central error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || 500;
    if (err.name === 'MulterError') status = 400;
    if (err.type === 'entity.parse.failed') status = 400;
    if (status >= 500) {
      // Keep the server log useful for unexpected failures.
      console.error(err);
    }
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
