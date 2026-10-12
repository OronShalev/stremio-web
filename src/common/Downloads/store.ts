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
                items: response.items,
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
        setState({ items: state.items.map((item) => item.id === id && item.status !== 'completed' ? { ...item, status: 'paused' } : item) });
        return withRefresh(api.pauseDownload(id));
    },
    resume: (id: string) => {
        setState({ items: state.items.map((item) => item.id === id && item.status !== 'completed' ? { ...item, status: 'downloading' } : item) });
        return withRefresh(api.resumeDownload(id));
    },
    remove: (id: string) => {
        setState({ items: state.items.filter((item: DownloadItem) => item.id !== id) });
        return withRefresh(api.deleteDownload(id));
    },
    reveal: (id: string) => api.revealDownload(id),
    refresh,
};
