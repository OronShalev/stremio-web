#!/usr/bin/env node

// Stremio Downloads Service
//
// A tiny local HTTP service (no dependencies, Node >= 18) that sits between
// stremio-web and qBittorrent:
//   * adds torrents to qBittorrent with a dedicated save path per title/episode
//   * keeps a `stremio-download.json` next to every download describing it
//   * lists downloads by scanning the downloads folder (the file system is the
//     source of truth) and enriches them with live qBittorrent progress
//   * pauses / resumes / deletes downloads (delete removes files from disk)
//   * serves downloaded video files over HTTP (with Range support) so the
//     Stremio player can play them
//
// Configuration (environment variables or downloads-service/config.json):
//   DOWNLOADS_SERVICE_PORT   default 11471
//   DOWNLOADS_SERVICE_HOST   default 127.0.0.1
//   DOWNLOADS_DIR            default <home>/AppData/Stremio/downloads
//   QBITTORRENT_URL          default http://localhost:8090
//   QBITTORRENT_USERNAME     optional (needed unless "bypass auth for localhost" is enabled)
//   QBITTORRENT_PASSWORD     optional
//   ALLOWED_ORIGINS          optional, comma separated extra origins allowed to use the API
//                            (any http(s)://localhost|127.0.0.1|[::1] origin is always allowed)

/* eslint-disable no-console, @typescript-eslint/no-empty-function */

'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const loadFileConfig = () => {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    } catch (_e) {
        return {};
    }
};

const fileConfig = loadFileConfig();
const cfg = (envName, fileKey, fallback) => {
    if (typeof process.env[envName] === 'string' && process.env[envName].length > 0) return process.env[envName];
    if (fileConfig[fileKey] !== undefined && fileConfig[fileKey] !== null && fileConfig[fileKey] !== '') return fileConfig[fileKey];
    return fallback;
};

const CONFIG = {
    port: parseInt(cfg('DOWNLOADS_SERVICE_PORT', 'port', '11471'), 10),
    host: cfg('DOWNLOADS_SERVICE_HOST', 'host', '127.0.0.1'),
    downloadsDir: path.resolve(cfg('DOWNLOADS_DIR', 'downloadsDir', path.join(os.homedir(), 'AppData', 'Stremio', 'downloads'))),
    qbtUrl: String(cfg('QBITTORRENT_URL', 'qbittorrentUrl', 'http://localhost:8090')).replace(/\/+$/, ''),
    qbtUsername: cfg('QBITTORRENT_USERNAME', 'qbittorrentUsername', ''),
    qbtPassword: cfg('QBITTORRENT_PASSWORD', 'qbittorrentPassword', ''),
    allowedOrigins: String(cfg('ALLOWED_ORIGINS', 'allowedOrigins', ''))
        .split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter((origin) => origin.length > 0),
    category: 'Stremio',
    tag: 'stremio',
};

const META_FILE = 'stremio-download.json';
const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.webm', '.ts', '.m2ts', '.mpg', '.mpeg', '.flv', '.ogv', '.3gp']);
const MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.ts': 'video/mp2t',
    '.m2ts': 'video/mp2t',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg',
    '.flv': 'video/x-flv',
    '.ogv': 'video/ogg',
    '.3gp': 'video/3gpp',
    '.srt': 'text/plain; charset=utf-8',
    '.vtt': 'text/vtt; charset=utf-8',
};

const log = (...args) => console.log(new Date().toISOString(), ...args);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isVideoFile = (name) => VIDEO_EXTENSIONS.has(path.extname(String(name)).toLowerCase());
const isHash = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
const pad2 = (n) => String(n).padStart(2, '0');

// Make a string safe to use as a single Windows / POSIX path segment
const sanitizeSegment = (value, fallback = 'Unknown') => {
    let s = String(value === undefined || value === null ? '' : value)
        .normalize('NFC')
        // eslint-disable-next-line no-control-regex
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '');
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
    if (s.length > 100) s = s.slice(0, 100).trim();
    return s.length > 0 ? s : fallback;
};

// Ensure a path is inside the downloads dir (prevents path traversal)
const isInsideDownloadsDir = (target) => {
    const relative = path.relative(CONFIG.downloadsDir, path.resolve(target));
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const buildTorrentDir = ({ type, name, season, episode, infoHash }) => {
    const title = sanitizeSegment(name);
    const hash = infoHash.toLowerCase();
    if (type === 'series' || type === 'anime' || (Number.isInteger(season) && Number.isInteger(episode))) {
        return path.join(
            CONFIG.downloadsDir,
            'series',
            title,
            Number.isInteger(season) ? `Season ${pad2(season)}` : 'Season 00',
            Number.isInteger(episode) ? `Episode ${pad2(episode)}` : 'Episode 00',
            hash
        );
    }
    if (type === 'movie') {
        return path.join(CONFIG.downloadsDir, 'movies', title, hash);
    }
    return path.join(CONFIG.downloadsDir, sanitizeSegment(type || 'other'), title, hash);
};

const fileExists = async (target) => {
    try {
        return await fsp.stat(target);
    } catch (_e) {
        return null;
    }
};

const readJson = async (file) => JSON.parse(await fsp.readFile(file, 'utf8'));

const writeJsonAtomic = async (file, data) => {
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmp, file);
};

// Remove empty parent folders up to (not including) the downloads dir
const pruneEmptyParents = async (startDir) => {
    let dir = startDir;
    while (isInsideDownloadsDir(dir)) {
        try {
            const entries = await fsp.readdir(dir);
            if (entries.length > 0) return;
            await fsp.rmdir(dir);
        } catch (_e) {
            return;
        }
        dir = path.dirname(dir);
    }
};

const buildMagnet = ({ infoHash, magnet, announce, name }) => {
    if (typeof magnet === 'string' && magnet.startsWith('magnet:?') && magnet.toLowerCase().includes(infoHash.toLowerCase())) {
        return magnet;
    }
    const params = [`xt=urn:btih:${infoHash.toLowerCase()}`];
    if (typeof name === 'string' && name.length > 0) params.push(`dn=${encodeURIComponent(name)}`);
    (Array.isArray(announce) ? announce : [])
        .filter((source) => typeof source === 'string')
        .map((source) => source.replace(/^tracker:/, ''))
        .filter((source) => /^(udp|https?|wss?):\/\//i.test(source))
        .forEach((tracker) => params.push(`tr=${encodeURIComponent(tracker)}`));
    return `magnet:?${params.join('&')}`;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// qBittorrent Web API client
// ---------------------------------------------------------------------------

class QBittorrentError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

const qbt = {
    cookie: null,
    loginPromise: null,
    version: null,
    webApiVersion: null,
    lastError: null,

    async login() {
        if (this.loginPromise) return this.loginPromise;
        this.loginPromise = (async () => {
            const body = new URLSearchParams({ username: CONFIG.qbtUsername, password: CONFIG.qbtPassword });
            const res = await fetch(`${CONFIG.qbtUrl}/api/v2/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: CONFIG.qbtUrl },
                body,
            });
            const text = await res.text();
            if (!res.ok || text.trim() === 'Fails.') {
                throw new QBittorrentError('qBittorrent login failed - check QBITTORRENT_USERNAME / QBITTORRENT_PASSWORD', 401);
            }
            const setCookie = res.headers.get('set-cookie');
            const match = setCookie && setCookie.match(/(SID|QBT_SID_\d+)=([^;]+)/);
            this.cookie = match ? `${match[1]}=${match[2]}` : null;
        })().finally(() => {
            this.loginPromise = null;
        });
        return this.loginPromise;
    },

    async request(endpoint, { method = 'GET', query, form, retry = true } = {}) {
        const url = new URL(`${CONFIG.qbtUrl}/api/v2/${endpoint}`);
        if (query) Object.entries(query).forEach(([key, value]) => value !== undefined && url.searchParams.set(key, String(value)));
        const headers = { Referer: CONFIG.qbtUrl };
        if (this.cookie) headers.Cookie = this.cookie;
        let body;
        if (form) {
            body = new URLSearchParams();
            Object.entries(form).forEach(([key, value]) => value !== undefined && body.set(key, String(value)));
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        let res;
        try {
            res = await fetch(url, { method: form ? 'POST' : method, headers, body });
        } catch (error) {
            this.lastError = `Cannot reach qBittorrent at ${CONFIG.qbtUrl} (${error.cause?.code || error.message})`;
            throw new QBittorrentError(this.lastError, 503);
        }
        if (res.status === 403 && retry) {
            await this.login();
            return this.request(endpoint, { method, query, form, retry: false });
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new QBittorrentError(`qBittorrent ${endpoint} failed: ${res.status} ${text}`.trim(), res.status);
        }
        this.lastError = null;
        const contentType = res.headers.get('content-type') || '';
        return contentType.includes('application/json') ? res.json() : res.text();
    },

    async info() {
        if (this.version === null) {
            this.version = await this.request('app/version');
            this.webApiVersion = await this.request('app/webapiVersion').catch(() => null);
        }
        return { version: this.version, webApiVersion: this.webApiVersion };
    },

    async torrents(hashes) {
        return this.request('torrents/info', { query: hashes ? { hashes: hashes.join('|') } : undefined });
    },

    async files(hash) {
        const files = await this.request('torrents/files', { query: { hash } });
        return Array.isArray(files) ? files.map((file, i) => ({ ...file, index: Number.isInteger(file.index) ? file.index : i })) : [];
    },

    async ensureCategory() {
        try {
            await this.request('torrents/createCategory', { form: { category: CONFIG.category, savePath: CONFIG.downloadsDir } });
        } catch (error) {
            if (error.status !== 409) log('could not create qBittorrent category:', error.message);
        }
    },

    async add({ magnet, savePath }) {
        // qBittorrent 5 uses `stopped`, 4.x uses `paused` - we always want it running.
        return this.request('torrents/add', {
            form: {
                urls: magnet,
                savepath: savePath,
                category: CONFIG.category,
                tags: CONFIG.tag,
                autoTMM: 'false',
                sequentialDownload: 'true',
                firstLastPiecePrio: 'true',
                paused: 'false',
                stopped: 'false',
                contentLayout: 'Original',
            },
        });
    },

    // Try the qBittorrent 5 endpoint first, fall back to the 4.x name
    async withFallback(primary, fallback, form) {
        try {
            return await this.request(primary, { form });
        } catch (error) {
            if (error.status === 404) return this.request(fallback, { form });
            throw error;
        }
    },
    stop(hash) { return this.withFallback('torrents/stop', 'torrents/pause', { hashes: hash }); },
    start(hash) { return this.withFallback('torrents/start', 'torrents/resume', { hashes: hash }); },
    setFilePriority(hash, ids, priority) {
        if (ids.length === 0) return Promise.resolve();
        return this.request('torrents/filePrio', { form: { hash, id: ids.join('|'), priority } });
    },
    delete(hash, deleteFiles) {
        return this.request('torrents/delete', { form: { hashes: hash, deleteFiles: deleteFiles ? 'true' : 'false' } });
    },
};

// ---------------------------------------------------------------------------
// File system model
// ---------------------------------------------------------------------------

// Find every stremio-download.json under the downloads dir
const findMetaFiles = async (dir = CONFIG.downloadsDir, depth = 0, out = []) => {
    if (depth > 7) return out;
    let entries;
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (_e) {
        return out;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === META_FILE)) {
        out.push(path.join(dir, META_FILE));
        return out; // a torrent folder - don't descend into the torrent content
    }
    await Promise.all(entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => findMetaFiles(path.join(dir, entry.name), depth + 1, out)));
    return out;
};

// Walk a torrent folder and return all video files (relative paths)
const listVideoFiles = async (root, dir = root, out = []) => {
    let entries;
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (_e) {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await listVideoFiles(root, full, out);
        } else if (entry.isFile()) {
            const cleanName = entry.name.replace(/\.!qB$/, '');
            if (isVideoFile(cleanName)) {
                const stat = await fileExists(full);
                out.push({ relativePath: path.relative(root, full), size: stat ? stat.size : 0, partial: entry.name.endsWith('.!qB') });
            }
        }
    }
    return out;
};

// Locate a torrent file on disk (qBittorrent may append .!qB to incomplete files)
const resolveOnDisk = async (dir, relativePath) => {
    if (typeof relativePath !== 'string' || relativePath.length === 0) return null;
    const full = path.join(dir, relativePath);
    if (!isInsideDownloadsDir(full)) return null;
    const stat = await fileExists(full);
    if (stat && stat.isFile()) return { path: full, size: stat.size, partial: false };
    const partialStat = await fileExists(`${full}.!qB`);
    if (partialStat && partialStat.isFile()) return { path: `${full}.!qB`, size: partialStat.size, partial: true };
    return null;
};

// Per-folder lock so concurrent writes to the same metadata file don't race
const locks = new Map();
const withLock = async (key, fn) => {
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    locks.set(key, previous.then(() => current));
    await previous;
    try {
        return await fn();
    } finally {
        release();
        if (locks.get(key) === current) locks.delete(key);
    }
};

const updateMeta = (dir, updater) => withLock(dir, async () => {
    const file = path.join(dir, META_FILE);
    const current = await readJson(file).catch(() => null);
    const next = await updater(current);
    if (next) await writeJsonAtomic(file, next);
    return next;
});

// Torrent hashes whose file priorities have been verified this session
const prioritiesApplied = new Set();

// Make sure only the wanted files of a torrent are downloaded.
// Returns the wanted qBittorrent files once metadata is available, null otherwise.
const applyFileSelection = async (dir, meta, torrent) => {
    const hash = meta.infoHash;
    const files = await qbt.files(hash);
    if (files.length === 0) return null; // metadata not downloaded yet

    let changed = false;
    const items = meta.items.map((item) => {
        if (Number.isInteger(item.fileIdx) && files.some((file) => file.index === item.fileIdx)) {
            return item;
        }
        // No (valid) fileIdx - pick the biggest video file, like the Stremio streaming server does
        const biggest = files
            .filter((file) => isVideoFile(file.name))
            .sort((a, b) => b.size - a.size)[0] || files.slice().sort((a, b) => b.size - a.size)[0];
        changed = true;
        return { ...item, fileIdx: biggest.index };
    });
    const wanted = new Set(items.map((item) => item.fileIdx));
    const itemsWithFiles = items.map((item) => {
        const file = files.find((f) => f.index === item.fileIdx);
        if (file && (item.fileName !== file.name || item.size !== file.size)) {
            changed = true;
            return { ...item, fileName: file.name, size: file.size };
        }
        return item;
    });

    if (!prioritiesApplied.has(hash)) {
        const unwanted = files.filter((file) => !wanted.has(file.index) && file.priority !== 0).map((file) => file.index);
        const missing = files.filter((file) => wanted.has(file.index) && file.priority === 0).map((file) => file.index);
        await qbt.setFilePriority(hash, unwanted, 0);
        await qbt.setFilePriority(hash, missing, 1);
        prioritiesApplied.add(hash);
        if (unwanted.length > 0 || missing.length > 0) log(`file selection applied for ${hash}: wanted [${[...wanted].join(', ')}]`);
        if (torrent && missing.length > 0 && /^(paused|stopped)UP$/.test(torrent.state)) {
            await qbt.start(hash).catch(() => {});
        }
    }

    if (changed) {
        await updateMeta(dir, (current) => current ? { ...current, items: current.items.map((item) => itemsWithFiles.find((i) => i.id === item.id) || item) } : null);
    }
    return { files, items: itemsWithFiles };
};

const mapState = (torrentState, itemProgress) => {
    if (itemProgress >= 1) return 'completed';
    switch (torrentState) {
        case 'metaDL':
        case 'forcedMetaDL':
            return 'metadata';
        case 'pausedDL':
        case 'stoppedDL':
        case 'pausedUP':
        case 'stoppedUP':
            return 'paused';
        case 'queuedDL':
        case 'queuedUP':
            return 'queued';
        case 'checkingDL':
        case 'checkingUP':
        case 'checkingResumeData':
        case 'moving':
        case 'allocating':
            return 'checking';
        case 'error':
        case 'missingFiles':
            return 'error';
        case 'stalledDL':
            return 'stalled';
        case 'uploading':
        case 'stalledUP':
        case 'forcedUP':
            return 'completed';
        default:
            return 'downloading';
    }
};

const itemId = (infoHash, itemKey) => `${infoHash.toLowerCase()}~${itemKey}`;

// Build the full list of downloads from disk + qBittorrent
const listDownloads = async () => {
    const metaFiles = await findMetaFiles();
    const metas = (await Promise.all(metaFiles.map(async (file) => {
        try {
            const meta = await readJson(file);
            if (!isHash(meta.infoHash) || !Array.isArray(meta.items)) return null;
            return { dir: path.dirname(file), meta };
        } catch (_e) {
            return null;
        }
    }))).filter(Boolean);

    let torrents = [];
    let qbtOnline = true;
    try {
        torrents = metas.length > 0 ? await qbt.torrents(metas.map(({ meta }) => meta.infoHash.toLowerCase())) : [];
    } catch (_e) {
        qbtOnline = false;
    }
    const torrentsByHash = new Map(torrents.map((torrent) => [torrent.hash.toLowerCase(), torrent]));

    const results = await Promise.all(metas.map(async ({ dir, meta }) => {
        const hash = meta.infoHash.toLowerCase();
        const torrent = torrentsByHash.get(hash) || null;
        let selection = null;
        if (torrent) {
            selection = await applyFileSelection(dir, meta, torrent).catch((error) => {
                log(`file selection failed for ${hash}:`, error.message);
                return null;
            });
        }
        const items = selection ? selection.items : meta.items;
        const videoFilesOnDisk = torrent ? null : await listVideoFiles(dir);

        return Promise.all(items.map(async (item) => {
            const qbtFile = selection ? selection.files.find((file) => file.index === item.fileIdx) : null;
            let onDisk = await resolveOnDisk(dir, qbtFile ? qbtFile.name : item.fileName);
            if (!onDisk && videoFilesOnDisk && videoFilesOnDisk.length > 0 && items.length === 1) {
                // Fallback for downloads not tracked by qBittorrent: the biggest video in the folder
                const biggest = videoFilesOnDisk.slice().sort((a, b) => b.size - a.size)[0];
                onDisk = { path: path.join(dir, biggest.relativePath), size: biggest.size, partial: biggest.partial };
            }

            const totalSize = qbtFile ? qbtFile.size : (Number.isFinite(item.size) ? item.size : (onDisk ? onDisk.size : 0));
            let progress;
            let status;
            if (torrent && qbtFile) {
                progress = qbtFile.progress;
                status = mapState(torrent.state, progress);
            } else if (torrent) {
                progress = 0;
                status = mapState(torrent.state, 0);
                if (status === 'completed') status = 'downloading';
            } else if (onDisk && !onDisk.partial && totalSize > 0 && onDisk.size >= totalSize) {
                progress = 1;
                status = 'completed';
            } else {
                progress = onDisk && totalSize > 0 ? Math.min(onDisk.size / totalSize, 0.999) : 0;
                status = qbtOnline ? 'missing' : 'unknown';
            }
            if (status === 'completed' && (!onDisk || onDisk.partial)) {
                status = onDisk ? 'completed' : 'error';
            }

            return {
                id: itemId(hash, item.id),
                infoHash: hash,
                itemKey: item.id,
                fileIdx: Number.isInteger(item.fileIdx) ? item.fileIdx : null,
                folder: dir,
                filePath: onDisk ? onDisk.path : null,
                fileName: qbtFile ? path.basename(qbtFile.name) : (onDisk ? path.basename(onDisk.path).replace(/\.!qB$/, '') : (item.fileName ? path.basename(item.fileName) : null)),
                size: totalSize,
                downloaded: Math.round(totalSize * progress),
                progress,
                status,
                torrent: torrent ? {
                    name: torrent.name,
                    state: torrent.state,
                    dlspeed: torrent.dlspeed,
                    upspeed: torrent.upspeed,
                    eta: torrent.eta,
                    seeds: torrent.num_seeds,
                    peers: torrent.num_leechs,
                    ratio: torrent.ratio,
                    progress: torrent.progress,
                } : null,
                addedAt: item.addedAt || meta.addedAt || null,
                completedAt: torrent && torrent.completion_on > 0 ? new Date(torrent.completion_on * 1000).toISOString() : null,
                meta: {
                    type: meta.type || null,
                    id: meta.metaId || null,
                    name: meta.name || null,
                    poster: meta.poster || null,
                    background: meta.background || null,
                    logo: meta.logo || null,
                    metaTransportUrl: meta.metaTransportUrl || null,
                },
                video: {
                    id: item.videoId || null,
                    season: Number.isInteger(item.season) ? item.season : null,
                    episode: Number.isInteger(item.episode) ? item.episode : null,
                    title: item.episodeTitle || null,
                },
                stream: {
                    title: item.streamTitle || null,
                    addonName: item.addonName || null,
                    streamTransportUrl: item.streamTransportUrl || null,
                    announce: Array.isArray(meta.announce) ? meta.announce : [],
                },
            };
        }));
    }));

    return { qbtOnline, items: results.flat() };
};

const findItem = async (id) => {
    const [hash, key] = String(id).split('~');
    if (!isHash(hash) || !key) return null;
    const { items } = await listDownloads();
    return items.find((item) => item.infoHash === hash.toLowerCase() && item.itemKey === key) || null;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const addDownload = async (body) => {
    const infoHash = String(body.infoHash || '').toLowerCase();
    if (!isHash(infoHash)) throw Object.assign(new Error('A valid infoHash is required'), { status: 400 });

    const meta = body.meta || {};
    const video = body.video || {};
    const stream = body.stream || {};
    const fileIdx = Number.isInteger(body.fileIdx) && body.fileIdx >= 0 ? body.fileIdx : null;
    const season = Number.isInteger(video.season) ? video.season : null;
    const episode = Number.isInteger(video.episode) ? video.episode : null;
    const key = fileIdx !== null ? `f${fileIdx}` : (video.id ? `v${sanitizeSegment(video.id, 'main').replace(/\s+/g, '_')}` : 'main');

    await fsp.mkdir(CONFIG.downloadsDir, { recursive: true });

    // Same torrent already being downloaded somewhere (e.g. a season pack)? Reuse its folder.
    const existing = (await Promise.all((await findMetaFiles()).map(async (file) => {
        const data = await readJson(file).catch(() => null);
        return data && typeof data.infoHash === 'string' && data.infoHash.toLowerCase() === infoHash ? path.dirname(file) : null;
    }))).find(Boolean);
    const dir = existing || buildTorrentDir({ type: meta.type, name: meta.name || stream.title || infoHash, season, episode, infoHash });
    if (!isInsideDownloadsDir(dir)) throw Object.assign(new Error('Invalid download path'), { status: 400 });
    await fsp.mkdir(dir, { recursive: true });

    const now = new Date().toISOString();
    const newItem = {
        id: key,
        fileIdx,
        videoId: video.id || null,
        season,
        episode,
        episodeTitle: video.title || null,
        streamTitle: [stream.name, stream.description || stream.title].filter(Boolean).join('\n') || null,
        addonName: stream.addonName || null,
        streamTransportUrl: stream.streamTransportUrl || null,
        addedAt: now,
    };
    const saved = await updateMeta(dir, (current) => {
        const base = current || {
            version: 1,
            infoHash,
            type: meta.type || null,
            metaId: meta.id || null,
            name: meta.name || null,
            poster: meta.poster || null,
            background: meta.background || null,
            logo: meta.logo || null,
            metaTransportUrl: meta.metaTransportUrl || null,
            announce: Array.isArray(body.announce) ? body.announce : [],
            addedAt: now,
            items: [],
        };
        const already = base.items.find((item) => item.id === key || (fileIdx !== null && item.fileIdx === fileIdx));
        return { ...base, items: already ? base.items : [...base.items, newItem] };
    });

    await qbt.ensureCategory();
    const [torrent] = await qbt.torrents([infoHash]);
    if (torrent) {
        // Torrent already known to qBittorrent: re-apply file selection and make sure it runs
        prioritiesApplied.delete(infoHash);
        await applyFileSelection(dir, saved, torrent).catch(() => null);
        if (/^(paused|stopped)(DL|UP)$/.test(torrent.state)) await qbt.start(infoHash).catch(() => {});
    } else {
        const magnet = buildMagnet({ infoHash, magnet: body.magnet, announce: body.announce, name: meta.name });
        const result = await qbt.add({ magnet, savePath: dir });
        if (typeof result === 'string' && result.trim() === 'Fails.') throw new Error('qBittorrent refused the torrent');
        prioritiesApplied.delete(infoHash);
        watchForMetadata(dir, infoHash);
    }
    log(`download added ${infoHash} (${meta.name || 'unknown'}) -> ${dir}`);
    const item = await findItem(itemId(infoHash, key));
    return item;
};

// After adding a magnet, apply the file selection as soon as metadata arrives
const watchForMetadata = (dir, infoHash) => {
    (async () => {
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline) {
            await sleep(1000);
            try {
                const meta = await readJson(path.join(dir, META_FILE));
                const [torrent] = await qbt.torrents([infoHash]);
                if (!torrent) return;
                const result = await applyFileSelection(dir, meta, torrent);
                if (result) return;
            } catch (_e) {
                // keep trying
            }
        }
    })();
};

const STOPPED_STATE = /^(paused|stopped)(DL|UP)$/;

// qBittorrent applies stop / start asynchronously - wait (briefly) until its
// reported state reflects the change so the UI gets the new state right away
const waitForState = async (hash, predicate, timeout = 4000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const [torrent] = await qbt.torrents([hash]).catch(() => []);
        if (!torrent || predicate(torrent.state)) return;
        await sleep(200);
    }
};

const pauseDownload = async (item) => {
    await qbt.stop(item.infoHash);
    await waitForState(item.infoHash, (state) => STOPPED_STATE.test(state));
};

const resumeDownload = async (item) => {
    const [torrent] = await qbt.torrents([item.infoHash]);
    if (torrent) {
        await qbt.start(item.infoHash);
        await waitForState(item.infoHash, (state) => !STOPPED_STATE.test(state));
        return;
    }
    // Torrent was removed from qBittorrent but files are still on disk: re-add it,
    // qBittorrent will check the existing data and continue
    const meta = await readJson(path.join(item.folder, META_FILE));
    const magnet = buildMagnet({ infoHash: item.infoHash, announce: meta.announce, name: meta.name });
    await qbt.add({ magnet, savePath: item.folder });
    prioritiesApplied.delete(item.infoHash);
    watchForMetadata(item.folder, item.infoHash);
};

const deleteDownload = async (item) => {
    const dir = item.folder;
    if (!isInsideDownloadsDir(dir)) throw Object.assign(new Error('Refusing to delete outside downloads folder'), { status: 400 });
    const meta = await readJson(path.join(dir, META_FILE));
    const remaining = meta.items.filter((i) => i.id !== item.itemKey);

    if (remaining.length > 0) {
        // Other episodes of the same torrent still wanted: only drop this file
        if (item.fileIdx !== null) await qbt.setFilePriority(item.infoHash, [item.fileIdx], 0).catch(() => {});
        if (item.filePath && isInsideDownloadsDir(item.filePath)) await fsp.rm(item.filePath, { force: true });
        await updateMeta(dir, (current) => current ? { ...current, items: current.items.filter((i) => i.id !== item.itemKey) } : null);
        prioritiesApplied.delete(item.infoHash);
    } else {
        await qbt.delete(item.infoHash, true).catch((error) => {
            if (error.status === 503) throw error; // qBittorrent offline - don't leave a torrent writing into a deleted dir
        });
        // Give qBittorrent a moment to release file handles (Windows)
        for (let attempt = 0; attempt < 10; attempt++) {
            try {
                await fsp.rm(dir, { recursive: true, force: true });
                break;
            } catch (error) {
                if (attempt === 9) throw error;
                await sleep(300);
            }
        }
        await pruneEmptyParents(path.dirname(dir));
        prioritiesApplied.delete(item.infoHash);
    }
    log(`download deleted ${item.id}`);
};

const revealDownload = (item) => {
    const target = item.filePath || item.folder;
    let child;
    if (process.platform === 'win32') {
        // Explorer only understands `/select,"C:\path with spaces\file"` - Node's default
        // quoting wraps the whole argument and Explorer falls back to opening Documents.
        const args = item.filePath ? `/select,"${path.win32.normalize(target)}"` : `"${path.win32.normalize(target)}"`;
        child = spawn('explorer.exe', [args], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
    } else if (process.platform === 'darwin') {
        child = spawn('open', item.filePath ? ['-R', target] : [target], { detached: true, stdio: 'ignore' });
    } else {
        child = spawn('xdg-open', [item.folder], { detached: true, stdio: 'ignore' });
    }
    child.on('error', () => {});
    child.unref();
};

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    try {
        const { hostname, protocol } = new URL(origin);
        if ((protocol === 'http:' || protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) return true;
    } catch (_e) {
        return false;
    }
    return CONFIG.allowedOrigins.includes(origin.replace(/\/+$/, ''));
};

const setCors = (req, res) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
        res.setHeader('Access-Control-Max-Age', '600');
        if (req.headers['access-control-request-private-network']) {
            res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }
    }
};

const sendJson = (res, status, data) => {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
};

const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
            reject(Object.assign(new Error('Body too large'), { status: 413 }));
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        try {
            resolve(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch (_e) {
            reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
        }
    });
    req.on('error', reject);
});

// Serve a file with HTTP Range support (needed for seeking in the player)
const serveFile = async (req, res, filePath, downloadName) => {
    const stat = await fileExists(filePath);
    if (!stat || !stat.isFile()) return sendJson(res, 404, { error: 'File not found' });
    const ext = path.extname(filePath.replace(/\.!qB$/, '')).toLowerCase();
    const headers = {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(downloadName || path.basename(filePath))}`,
    };
    const range = req.headers.range && req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    if (range) {
        if (range[1] === '' && range[2] !== '') {
            start = Math.max(stat.size - parseInt(range[2], 10), 0);
        } else {
            start = parseInt(range[1] || '0', 10);
            if (range[2] !== '') end = Math.min(parseInt(range[2], 10), stat.size - 1);
        }
        if (start > end || start >= stat.size) {
            res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
            return res.end();
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = stat.size === 0 ? 0 : end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || stat.size === 0) return res.end();
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => res.destroy());
    req.on('close', () => stream.destroy());
    stream.pipe(res);
};

const route = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (req.method === 'OPTIONS') {
        res.writeHead(isAllowedOrigin(req.headers.origin) ? 204 : 403);
        return res.end();
    }
    if (!isAllowedOrigin(req.headers.origin)) {
        return sendJson(res, 403, { error: `Origin ${req.headers.origin} is not allowed. Add it to ALLOWED_ORIGINS.` });
    }

    // GET /api/health
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'health') {
        let qbittorrent;
        try {
            qbt.version = null;
            const info = await qbt.info();
            qbittorrent = { online: true, ...info, url: CONFIG.qbtUrl };
        } catch (error) {
            qbt.version = null;
            qbittorrent = { online: false, error: error.message, url: CONFIG.qbtUrl };
        }
        return sendJson(res, 200, { ok: true, downloadsDir: CONFIG.downloadsDir, qbittorrent });
    }

    // GET /api/downloads
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'downloads' && parts.length === 2) {
        const { qbtOnline, items } = await listDownloads();
        let freeSpace = null;
        try {
            if (typeof fsp.statfs === 'function') {
                const stats = await fsp.statfs(fs.existsSync(CONFIG.downloadsDir) ? CONFIG.downloadsDir : os.homedir());
                freeSpace = stats.bavail * stats.bsize;
            }
        } catch (_e) {
            // ignore
        }
        return sendJson(res, 200, {
            downloadsDir: CONFIG.downloadsDir,
            qbittorrent: { online: qbtOnline, url: CONFIG.qbtUrl, error: qbtOnline ? null : qbt.lastError },
            freeSpace,
            items,
        });
    }

    // POST /api/downloads
    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'downloads' && parts.length === 2) {
        const body = await readBody(req);
        const item = await addDownload(body);
        return sendJson(res, 201, { item });
    }

    // /api/downloads/:id[/action]
    if (parts[0] === 'api' && parts[1] === 'downloads' && parts.length >= 3) {
        const item = await findItem(parts[2]);
        if (!item) return sendJson(res, 404, { error: 'Download not found' });
        const action = parts[3];
        if (req.method === 'GET' && !action) return sendJson(res, 200, { item });
        if (req.method === 'DELETE' && !action) {
            await deleteDownload(item);
            return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'POST' && action === 'pause') {
            await pauseDownload(item);
            return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'POST' && action === 'resume') {
            await resumeDownload(item);
            return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'POST' && action === 'reveal') {
            revealDownload(item);
            return sendJson(res, 200, { ok: true });
        }
    }

    // GET|HEAD /stream/:id/:filename  - play a downloaded file
    if ((req.method === 'GET' || req.method === 'HEAD') && parts[0] === 'stream' && parts.length >= 2) {
        const item = await findItem(parts[1]);
        if (!item || !item.filePath || !isInsideDownloadsDir(item.filePath)) return sendJson(res, 404, { error: 'File not found' });
        return serveFile(req, res, item.filePath, item.fileName);
    }

    return sendJson(res, 404, { error: 'Not found' });
};

const server = http.createServer((req, res) => {
    setCors(req, res);
    route(req, res).catch((error) => {
        const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
        if (status >= 500) log(`${req.method} ${req.url} failed:`, error.message);
        if (!res.headersSent) sendJson(res, status, { error: error.message });
        else res.destroy();
    });
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${CONFIG.port} is already in use - is the downloads service already running?`);
        process.exit(1);
    }
    throw error;
});

if (require.main === module) {
    fs.mkdirSync(CONFIG.downloadsDir, { recursive: true });
    server.listen(CONFIG.port, CONFIG.host, () => {
        log(`Stremio downloads service listening on http://${CONFIG.host}:${CONFIG.port}`);
        log(`Downloads folder: ${CONFIG.downloadsDir}`);
        log(`qBittorrent Web UI: ${CONFIG.qbtUrl}${CONFIG.qbtUsername ? ` (user ${CONFIG.qbtUsername})` : ' (no credentials - relies on localhost auth bypass)'}`);
        qbt.info()
            .then(({ version }) => log(`Connected to qBittorrent ${version}`))
            .catch((error) => log(`WARNING: ${error.message}`));
    });
}

module.exports = { server, CONFIG, sanitizeSegment, buildTorrentDir, buildMagnet };
