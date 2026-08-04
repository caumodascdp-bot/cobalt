#!/usr/bin/env node
// startup wrapper for cobalt on render:
// handles cookie format transformation and boots the api.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { env } from 'node:process';

const DEST = 'cookies/youtube.txt';

/**
 * transforms cookie objects into the format cobalt expects.
 *
 * cobalt wants:  {"youtube": ["name=value; Domain=x; Path=/; Secure; HttpOnly", …]}
 * browser export: {"youtube": [{"name":"ST-x","value":"csn=…","domain":".youtube.com", …}]}
 */
function transform(raw) {
    // try parsing as json
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // plain text – use as-is (could be netscape format, cobalt will handle it)
        return raw;
    }

    if (!parsed || typeof parsed !== 'object') return raw;

    const out = {};
    for (const [service, cookies] of Object.entries(parsed)) {
        if (!Array.isArray(cookies)) {
            out[service] = cookies;
            continue;
        }
        if (cookies.length === 0) continue;

        if (typeof cookies[0] === 'string') {
            // already in the right format
            out[service] = cookies;
        } else if (typeof cookies[0] === 'object' && cookies[0] !== null) {
            // transform from { name, value, domain, path, secure, httpOnly } -> string
            out[service] = cookies.map(c => {
                const parts = [`${c.name}=${c.value}`];
                if (c.domain)      parts.push(`Domain=${c.domain}`);
                if (c.path)        parts.push(`Path=${c.path}`);
                if (c.secure)      parts.push('Secure');
                if (c.httpOnly)    parts.push('HttpOnly');
                if (c.sameSite)    parts.push(`SameSite=${c.sameSite}`);
                if (c.expirationDate)
                    parts.push(`Expires=${new Date(c.expirationDate * 1000).toUTCString()}`);
                return parts.join('; ');
            });
        }
    }

    return JSON.stringify(out, null, 2);
}

async function main() {
    // ensure cookies/ dir exists
    await mkdir('cookies', { recursive: true });

    const secretsPath = '/etc/secrets/youtube.txt';
    let wroteCookie = false;

    // 1. try render secret-file first
    if (existsSync(secretsPath)) {
        try {
            const data = await readFile(secretsPath, 'utf8');
            if (data && data.length > 10) {
                const cooked = transform(data);
                await writeFile(DEST, cooked);
                console.log('[start] cookies loaded from /etc/secrets/youtube.txt');
                wroteCookie = true;
            }
        } catch (e) {
            console.warn('[start] could not read secret file:', e.message);
        }
    }

    // 2. fallback: YOUTUBE_COOKIES_JSON env var
    if (!wroteCookie && env.YOUTUBE_COOKIES_JSON && env.YOUTUBE_COOKIES_JSON.length > 10) {
        try {
            const cooked = transform(env.YOUTUBE_COOKIES_JSON);
            await writeFile(DEST, cooked);
            env.COOKIE_PATH = DEST;
            console.log('[start] cookies loaded from YOUTUBE_COOKIES_JSON env');
            wroteCookie = true;
        } catch (e) {
            console.warn('[start] could not parse YOUTUBE_COOKIES_JSON:', e.message);
        }
    }

    // point cobalt at the file regardless of which source won
    if (wroteCookie) {
        env.COOKIE_PATH = DEST;
    }

    // boot cobalt
    const child = spawn('node', ['src/cobalt'], { stdio: 'inherit', env });
    child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        else process.exit(code ?? 0);
    });
}

main().catch(err => {
    console.error('[start] fatal:', err.message);
    // still try to boot cobalt so we don't brick deploys
    const child = spawn('node', ['src/cobalt'], { stdio: 'inherit', env });
    child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        else process.exit(code ?? 0);
    });
});