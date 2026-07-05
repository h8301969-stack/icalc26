import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const set = new Set();

while (set.size < 200) {
  let p = '';
  for (let i = 0; i < 7; i += 1) {
    p += chars[Math.floor(Math.random() * chars.length)];
  }
  set.add(p);
}

const passwords = [...set].sort();

const txt = passwords.map((p, i) => `${String(i + 1).padStart(3, '0')}. ${p}`).join('\n');
fs.writeFileSync(path.join(root, 'invite-passwords.txt'), `${txt}\n`);

const ts = `export const INVITE_PASSWORDS: readonly string[] = ${JSON.stringify(passwords, null, 2)} as const;\n`;
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'invitePasswords.ts'), ts);

console.log(`Generated ${passwords.length} invite passwords.`);