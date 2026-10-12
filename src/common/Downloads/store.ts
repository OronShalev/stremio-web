// Copyright (C) 2017-2026 Smart code 203358507

import * as api from './api';
import type { AddDownloadRequest, DownloadItem, DownloadsState } from './types';

// A tiny shared store that polls the downloads service while at least one
// component is subscribed. All stream rows and the Downloads page share it,
// so there is only ever one poll loop.

const ACTIVE_INTERVAL = 1500;
const IDLE_INTERVAL = 5000;
const OFFLINE_INTERVAL = 15000;

const ACTIVE_STATUSES = new Set(['metadata', 'downloading', 'stalled', 'queued', 'checking']);

// qBittorrent applies pause / resume asynchronously, so a refresh right after the
// click can still report the old state. Keep the requested state (per torrent)
// until qBittorrent confirms it, or until the timeout expires.
const PENDING_TIMEOUT = 15000;
type PendingChange = { status: 'paused' | 'downloading', until: number };
const pending = new Map<string, PendingChange>();

const isConfirmed = (change: PendingChange, item: DownloadItem) => {
    return change.status === 'paused' ? item.status === 'paused' : item.status !== 'paused';
};

const applyPending = (items: DownloadItem[]): DownloadItem[] => {
    const now = Date.now();
    pending.forEach((change, infoHash) => {
        const torrentItems = items.filter((item) => item.infoHash === infoHash && item.status !== 'completed');
        if (now > change.until || torrentItems.length === 0 || torrentItems.every((item) => isConfirmed(change, item))) {
            pending.delete(infoHash);
        }
    });

    return items.map((item) => {
        const change = pending.get(item.infoHash);
        return change && item.status !== 'completed' && !isConfirmed(change, item) ? { ...item, status: change.status } : item;
    });
};

const setPending = (id: string, status: PendingChange['status']) => {
    const target = state.items.find((item) => item.id === id);
    if (!target) return null;
    pending.set(target.infoHash, { status, until: Date.now() + PENDING_TIMEOUT });
    setState({ items: applyPending(state.items) });
    return target.infoHash;
};

const clearPending = (infoHash: string | null) => {
    if (infoHash !== null) pending.delete(infoHash);
};

let state: DownloadsState = {
    status: 'idle',
    items: [],
    downloadsDir: null,
    freeSpace: null,
    qbittorrent: { online: false, url: null, error: null },
    error: null,
};

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

const setState = (next: Partial<DownloadsState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
};

const nextInterval = () => {
    if (state.status === 'offline') return OFFLINE_INTERVAL;
    if (pending.size > 0) return ACTIVE_INTERVAL;
    return state.items.some((item) => ACTIVE_STATUSES.has(item.status)) ? ACTIVE_INTERVAL : IDLE_INTERVAL;
};

const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (listeners.size === 0) return;
    timer = setTimeout(() => {
        if (typeof document !== 'undefined' && document.hidden) {
            schedule();
            return;
        }
        refresh();
    }, nextInterval());
};

export const refresh = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (state.status === 'idle') setState({ status: 'loading' });
    inFlight = api.listDownloads()
        .then((response) => {
            setState({
                status: 'ready',
                items: applyPending(response.items),
                downloadsDir: response.downloadsDir,
                freeSpace: response.freeSpace,
                qbittorrent: {
                    online: response.qbittorrent.online,
                    url: response.qbittorrent.url,
                    error: response.qbittorrent.error,
                },
                error: null,
            });
        })
        .catch((error: api.DownloadsServiceError) => {
            setState({
                status: error.offline ? 'offline' : 'ready',
                error: error.message,
                ...(error.offline ? { items: [] } : {}),
            });
        })
        .finally(() => {
            inFlight = null;
            schedule();
        });

    return inFlight;
};

const onVisibilityChange = () => {
    if (!document.hidden && listeners.size > 0) refresh();
};

export const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
        document.addEventListener('visibilitychange', onVisibilityChange);
        refresh();
    }

    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            if (timer !== null) clearTimeout(timer);
            timer = null;
        }
    };
};

export const getSnapshot = () => state;

const withRefresh = async <T>(promise: Promise<T>): Promise<T> => {
    try {
        return await promise;
    } finally {
        await refresh();
    }
};

export const actions = {
    add: (request: AddDownloadRequest) => withRefresh(api.addDownload(request)),
    pause: (id: string) => {
        const infoHash = setPending(id, 'paused');
        return withRefresh(api.pauseDownload(id).catch((error) => {
            clearPending(infoHash);
            throw error;
        }));
    },
    resume: (id: string) => {
        const infoHash = setPending(id, 'downloading');
        return withRefresh(api.resumeDownload(id).catch((error) => {
            clearPending(infoHash);
            throw error;
        }));
    },
    remove: (id: string) => {
        setState({ items: state.items.filter((item: DownloadItem) => item.id !== id) });
        return withRefresh(api.deleteDownload(id));
    },
    reveal: (id: string) => api.revealDownload(id),
    refresh,
};
