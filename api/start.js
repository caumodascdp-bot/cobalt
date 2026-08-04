#!/usr/bin/env node
// startup wrapper for cobalt: tries EVERYTHING to load cookies.
// sources: .env → /etc/secrets/youtube.txt → YOUTUBE_COOKIES_JSON
// formats: netscape (tab) → json-objects → cobalt-native-json

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { env } from 'node:process';
import dotenv from 'dotenv';

const DEST = 'cookies/youtube.txt';

// ── format parsers ────────────────────────────────────────────────

/** detect whether raw text looks like a netscape cookie file */
function looksLikeNetscape(text) {
    return /^[^\t]+\t(?:TRUE|FALSE)\t/.test(text.trim());
}

/** convert a netscape cookie file into cobalt format */
function netscapeToCobalt(text) {
    const cookieStrings = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split('\t');
        if (parts.length < 7) continue;
        const [domain, , path, secure, , name, ...rest] = parts;
        const value = rest.join('\t');
        const attrs = [`${name}=${value}`];
        if (domain) attrs.push(`Domain=${domain}`);
        if (path)   attrs.push(`Path=${path}`);
        if (secure === 'TRUE') attrs.push('Secure');
        attrs.push('HttpOnly');
        cookieStrings.push(attrs.join('; '));
    }
    return { youtube: cookieStrings };
}

/** convert browser-json-object format to cobalt format */
function objectJsonToCobalt(parsed) {
    const out = {};
    for (const [service, cookies] of Object.entries(parsed)) {
        if (!Array.isArray(cookies)) continue;
        out[service] = cookies.map(c => {
            if (typeof c === 'string') return c;       // already a string
            const parts = [`${c.name}=${c.value}`];
            if (c.domain) parts.push(`Domain=${c.domain}`);
            if (c.path)   parts.push(`Path=${c.path}`);
            if (c.secure)   parts.push('Secure');
            if (c.httpOnly) parts.push('HttpOnly');
            return parts.join('; ');
        });
    }
    return out;
}

/** try every parse strategy until one works — returns null on total failure */
function tryParse(raw) {
    if (!raw || raw.length < 5) return null;

    // 1 – already valid cobalt json?  {"youtube": ["…", …]}
    try {
        const p = JSON.parse(raw);
        if (typeof p === 'object' && !Array.isArray(p)) {
            // verify at least one service has string entries
            for (const v of Object.values(p)) {
                if (Array.isArray(v) && v.length && typeof v[0] === 'string')
                    return p; // looks good already
            }
        }
    } catch {}

    // 2 – netscape (tab-separated) format
    if (looksLikeNetscape(raw)) {
        return netscapeToCobalt(raw);
    }

    // 3 – json with object arrays  {"youtube": [{name,value,domain,…}, …]}
    try {
        const p = JSON.parse(raw);
        if (typeof p === 'object' && !Array.isArray(p)) {
            return objectJsonToCobalt(p);
        }
        // top-level array of objects with .name / .value
        if (Array.isArray(p) && p.length && typeof p[0] === 'object' && p[0].name !== undefined) {
            return { youtube: objectJsonToCobalt({ youtube: p }).youtube };
        }
    } catch {}

    // 4 – raw text: maybe each line is "name=value; Domain=…"
    //    wrap as youtube array
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (lines.length) {
        const hasEquals = lines.some(l => l.includes('='));
        if (hasEquals) return { youtube: lines };
    }

    return null;
}

// ── source readers ────────────────────────────────────────────────

async function tryWriteCookies() {
    await mkdir('cookies', { recursive: true });

    const candidates = [];

    // a) .env file (via dotenv)
    if (existsSync('.env')) {
        try {
            const raw = await readFile('.env', 'utf8');
            const parsed = dotenv.parse(raw);
            if (parsed.YOUTUBE_COOKIES_JSON || parsed.COOKIE_DATA) {
                const data = parsed.YOUTUBE_COOKIES_JSON || parsed.COOKIE_DATA;
                candidates.push({ data, label: '.env → YOUTUBE_COOKIES_JSON' });
            }
        } catch {}
    }

    // b) render secret file
    if (existsSync('/etc/secrets/youtube.txt')) {
        try {
            const data = await readFile('/etc/secrets/youtube.txt', 'utf8');
            candidates.push({ data, label: '/etc/secrets/youtube.txt' });
        } catch {}
    }

    // c) render secret file – alt path
    if (existsSync('/etc/secrets/YOUTUBE_COOKIES_JSON')) {
        try {
            const data = await readFile('/etc/secrets/YOUTUBE_COOKIES_JSON', 'utf8');
            candidates.push({ data, label: '/etc/secrets/YOUTUBE_COOKIES_JSON' });
        } catch {}
    }

    // d) env var
    if (env.YOUTUBE_COOKIES_JSON && env.YOUTUBE_COOKIES_JSON.length > 10) {
        candidates.push({ data: env.YOUTUBE_COOKIES_JSON, label: 'env YOUTUBE_COOKIES_JSON' });
    }

    // try each candidate in order
    for (const { data, label } of candidates) {
        const parsed = tryParse(data);
        if (parsed) {
            const json = JSON.stringify(parsed, null, 2);
            await writeFile(DEST, json);
            env.COOKIE_PATH = DEST;
            console.log(`[start] ✓ cookies loaded from ${label}`);
            return true;
        } else {
            console.warn(`[start] ✗ ${label} — unrecognised format (${data.length}b), skipping`);
        }
    }

    console.warn('[start] no cookie source found, starting without cookies');
    return false;
}

// ── boot ──────────────────────────────────────────────────────────

async function main() {
    await tryWriteCookies();

    const child = spawn('node', ['src/cobalt'], { stdio: 'inherit', env });
    child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        else process.exit(code ?? 0);
    });
}

main().catch(err => {
    console.error('[start] fatal:', err.message);
    const child = spawn('node', ['src/cobalt'], { stdio: 'inherit', env });
    child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        else process.exit(code ?? 0);
    });
});