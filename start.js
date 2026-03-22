import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(fileURLToPath(import.meta.url));

const PORT     = process.env.PORT || '3000';
const API_PORT = '8080';

const env = { ...process.env, NODE_ENV: 'production' };

// Start API server on port 8080
const api = spawn('node', [join(root, 'artifacts/api-server/dist/index.cjs')], {
  env: { ...env, PORT: API_PORT },
  stdio: 'inherit',
});
api.on('error', (e) => { console.error('API server error:', e); process.exit(1); });

// Start web server on PORT (provided by Hostinger)
const web = spawn('node', [join(root, 'artifacts/ai-timestamp/server.js')], {
  env: { ...env, PORT, BASE_PATH: '/' },
  stdio: 'inherit',
});
web.on('error', (e) => { console.error('Web server error:', e); process.exit(1); });

process.on('SIGTERM', () => { api.kill(); web.kill(); });
process.on('SIGINT',  () => { api.kill(); web.kill(); });

console.log(`TimestampAI starting — web on PORT=${PORT}, api on PORT=${API_PORT}`);
