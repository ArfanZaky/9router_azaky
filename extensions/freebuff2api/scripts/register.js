#!/usr/bin/env node
/**
 * scripts/register.js — CLI front-end for the native register automation
 * (`npm run register`). Same engine the dashboard uses: ../register.js.
 *
 * Headed by default — Google answers "this browser or app may not be secure"
 * to headless Chrome. On a headless host: `xvfb-run -a npm run register -- …`.
 *
 *   npm run register -- --email user@dom.com --password 'pw'
 *   npm run register -- --batch accounts.txt --proxy socks5h://host:1080
 *   npm run register -- --batch accounts.txt --out tokens.txt --headless
 */
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerBatch, parseAccountLines } from '../register.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const o = { email: '', password: '', batch: '', proxy: '', headless: false, out: '', keep: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') o.email = argv[++i] || '';
    else if (a === '--password') o.password = argv[++i] || '';
    else if (a === '--batch') o.batch = argv[++i] || '';
    else if (a === '--proxy') o.proxy = argv[++i] || '';
    else if (a === '--out') o.out = argv[++i] || '';
    else if (a === '--profile') o.keep = argv[++i] || '';
    else if (a === '--headless') o.headless = true;
    else if (a === '-h' || a === '--help') o.help = true;
  }
  return o;
}

const COLOR = { info: '\x1b[2m', ok: '\x1b[92m', warn: '\x1b[93m', err: '\x1b[91m' };
const log = (msg, level = 'info') =>
  console.log(`${COLOR[level] || ''}[register] ${msg}\x1b[0m`);

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: npm run register -- [flags]

  --email <e>      single account email
  --password <p>   single account password
  --batch <file>   file with "email:password" per line
  --proxy <url>    outbound proxy for HTTP + browser (http/https/socks5)
  --profile <dir>  reuse a browser profile dir (keeps the Google session)
  --headless       run headless (Google usually rejects it)
  --out <file>     append "<token>|<email>|<userId>" lines (default freebuff_tokens.txt)

Tokens also land in config.json so the gateway picks them up on next start.`);
  process.exit(0);
}

let accounts = [];
if (args.batch) {
  accounts = parseAccountLines(readFileSync(resolve(process.cwd(), args.batch), 'utf8'));
} else if (args.email && args.password) {
  accounts = [{ email: args.email, password: args.password }];
}
if (!accounts.length) {
  log('need --email/--password or --batch <file>', 'err');
  process.exit(2);
}

const outFile = resolve(process.cwd(), args.out || 'freebuff_tokens.txt');
const CONFIG = resolve(ROOT, 'config.json');

/** Merge a new token into config.json so the running gateway adopts it. */
function saveToConfig({ token, userId }) {
  try {
    let cfg = {};
    try { cfg = JSON.parse(readFileSync(CONFIG, 'utf8')); } catch {}
    const list = Array.isArray(cfg.tokens) ? cfg.tokens : [];
    const entry = userId ? `${token}:${userId}` : token;
    if (!list.some((t) => t === entry || String(t).split(':')[0] === token)) {
      list.push(entry);
      cfg.tokens = list;
      writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
      return true;
    }
  } catch (e) {
    log(`config.json update failed: ${e.message}`, 'warn');
  }
  return false;
}

log(`${accounts.length} account(s) proxy=${args.proxy || 'direct'} headless=${args.headless}`);

const results = await registerBatch(accounts, {
  proxy: args.proxy,
  headless: args.headless,
  profileDir: args.keep,
  log,
  onResult: (rec) => {
    if (!rec.ok) return;
    appendFileSync(outFile, `${rec.token}|${rec.email}|${rec.userId || ''}\n`);
    const added = saveToConfig(rec);
    log(`saved ${rec.email} → ${outFile}${added ? ' + config.json' : ''}`, 'ok');
  },
});

const ok = results.filter((r) => r.ok).length;
log(`done ok=${ok} failed=${results.length - ok}`, ok ? 'ok' : 'err');
process.exit(ok ? 0 : 1);
