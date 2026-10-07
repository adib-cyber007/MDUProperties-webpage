'use strict';
require('esbuild').buildSync({
  entryPoints: ['src/floor-plan-renderer.js'], bundle: true, minify: true,
  format: 'iife', target: ['es2020'], outfile: 'public/floor-plan-renderer.js',
  legalComments: 'eof', logLevel: 'info'
});
