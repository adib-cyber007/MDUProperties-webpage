'use strict';

// Vercel serverless entrypoint. The main application remains in server.js so
// local development (`node server.js`) and production share the same routes.
module.exports = require('../server');
