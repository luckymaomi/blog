import { buildSite } from './lib/build-site.js';

const result = buildSite();
console.log(`[talk] built ${result.pages} page(s) → ${result.out}`);
