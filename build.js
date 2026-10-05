import { buildSite } from './lib/build-site.js';

const result = buildSite();
console.log(`[blog] built ${result.pages} page(s) → ${result.out}`);
