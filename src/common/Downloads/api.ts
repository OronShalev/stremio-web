// Copyright (C) 2017-2026 Smart code 203358507

import type { AddDownloadRequest, DownloadItem } from './types';

// The local downloads service (see /downloads-service) bridges the UI with qBittorrent
// and the downloads folder. The URL can be overridden from the dev tools with:
//   localStorage.setItem('downloadsServiceUrl', 'http://127.0.0.1:11471')
export const DEFAULT_SERVICE_URL = 'http://127.0.0.1:11471';
const STORAGE_KEY = 'downloadsServiceUrl';

export const getServiceUrl = (): string => {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (typeof stored === 'string' && /^https?:\/\//.test(stored)) {
            return stored.replace(/\/+$/, '');
        }
    } catch (_e) {
        // localStorage not available
    }

    return DEFAULT_SERVICE_URL;
};

export class DownloadsServiceError extends Error {
    status: number;
    offline: boolean;

    constructor(message: string, status: number, offline = false) {
        super(message);
        this.status = status;
        this.offline = offline;
    }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    let response: Response;
    try {
        response = await fetch(`${getServiceUrl()}${path}`, {
            ...init,
            headers: {
                ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
                ...init?.headers,
            },
        });
    } catch (_e) {
        throw new DownloadsServiceError('Downloads service is not running', 0, true);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new DownloadsServiceError(data?.error ?? `Request failed (${response.status})`, response.status);
    }

    return data as T;
};

export type ListResponse = {
    downloadsDir: string,
    freeSpace: number | null,
    qbittorrent: { online: boolean, url: string, error: string | null },
    items: DownloadItem[],
};

const itemPath = (id: string) => `/api/downloads/${encodeURIComponent(id)}`;

export const listDownloads = () => request<ListResponse>('/api/downloads');

export const addDownload = (body: AddDownloadRequest) => request<{ item: DownloadItem | null }>('/api/downloads', {
    method: 'POST',
    body: JSON.stringify(body),
});

export const pauseDownload = (id: string) => request<{ ok: true }>(`${itemPath(id)}/pause`, { method: 'POST', body: '{}' });

export const resumeDownload = (id: string) => request<{ ok: true }>(`${itemPath(id)}/resume`, { method: 'POST', body: '{}' });

export const revealDownload = (id: string) => request<{ ok: true }>(`${itemPath(id)}/reveal`, { method: 'POST', body: '{}' });

export const deleteDownload = (id: string) => request<{ ok: true }>(itemPath(id), { method: 'DELETE' });

export const getFileUrl = (item: DownloadItem) => {
    return `${getServiceUrl()}/stream/${encodeURIComponent(item.id)}/${encodeURIComponent(item.fileName ?? 'video')}`;
};
