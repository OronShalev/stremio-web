// Copyright (C) 2017-2026 Smart code 203358507

export type DownloadStatus =
    'metadata' |
    'downloading' |
    'stalled' |
    'queued' |
    'checking' |
    'paused' |
    'completed' |
    'error' |
    'missing' |
    'unknown';

export type DownloadItem = {
    id: string,
    infoHash: string,
    itemKey: string,
    fileIdx: number | null,
    folder: string,
    filePath: string | null,
    fileName: string | null,
    size: number,
    downloaded: number,
    progress: number,
    status: DownloadStatus,
    torrent: {
        name: string,
        state: string,
        dlspeed: number,
        upspeed: number,
        eta: number,
        seeds: number,
        peers: number,
        ratio: number,
        progress: number,
    } | null,
    addedAt: string | null,
    completedAt: string | null,
    meta: {
        type: string | null,
        id: string | null,
        name: string | null,
        poster: string | null,
        background: string | null,
        logo: string | null,
        metaTransportUrl: string | null,
    },
    video: {
        id: string | null,
        season: number | null,
        episode: number | null,
        title: string | null,
    },
    stream: {
        title: string | null,
        addonName: string | null,
        streamTransportUrl: string | null,
        announce: string[],
    },
};

export type DownloadsState = {
    // idle: nobody asked yet, loading: first request in flight,
    // ready: service reachable, offline: the downloads service is not running
    status: 'idle' | 'loading' | 'ready' | 'offline',
    items: DownloadItem[],
    downloadsDir: string | null,
    freeSpace: number | null,
    qbittorrent: {
        online: boolean,
        url: string | null,
        error: string | null,
    },
    error: string | null,
};

export type DownloadContext = {
    meta: {
        type: string | null,
        id: string | null,
        name: string | null,
        poster: string | null,
        background: string | null,
        logo: string | null,
        metaTransportUrl: string | null,
    },
    video: {
        id: string | null,
        season: number | null,
        episode: number | null,
        title: string | null,
    },
};

export type DownloadableStream = {
    infoHash?: string,
    fileIdx?: number | null,
    announce?: string[],
    sources?: string[],
    name?: string,
    description?: string,
    title?: string,
    addonName?: string,
    addonTransportUrl?: string,
    deepLinks?: {
        externalPlayer?: {
            magnet?: string | null,
        } | null,
    } | null,
};

export type AddDownloadRequest = {
    infoHash: string,
    fileIdx: number | null,
    magnet: string | null,
    announce: string[],
    meta: DownloadContext['meta'],
    video: DownloadContext['video'],
    stream: {
        name: string | null,
        description: string | null,
        addonName: string | null,
        streamTransportUrl: string | null,
    },
};
