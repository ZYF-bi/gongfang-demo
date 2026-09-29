import { readFile, writeFile } from 'node:fs/promises';
let content = '';
try { content = await readFile('.env.local','utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const defaults = {
  AUTH_BACKEND: 'local',
  LOCAL_ACCESS_MODE: 'guest',
  APP_ORIGIN: 'http://127.0.0.1:3000',
  MODEL_API_BASE_URL: 'https://api.deepseek.com',
  MODEL_NAME: 'deepseek-flash',
  MODEL_API_KEY: '',
};
for (const [key,value] of Object.entries(defaults)) {
  // Preserve existing user-supplied values, particularly keys.
  if (!new RegExp(`^${key}=`, 'm').test(content)) content += `\n${key}=${value}\n`;
}
await writeFile('.env.local', content);
console.log('Local account settings prepared. Existing settings were preserved. Fill MODEL_API_KEY privately.');
