// Copyright (C) 2017-2026 Smart code 203358507

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export const formatBytes = (bytes: number | null | undefined) => {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return '0 B';
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
    const value = bytes / Math.pow(1024, exponent);
    return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[exponent]}`;
};

export const formatSpeed = (bytesPerSecond: number | null | undefined) => {
    return `${formatBytes(bytesPerSecond ?? 0)}/s`;
};

export const formatEta = (seconds: number | null | undefined) => {
    // qBittorrent reports 8640000 (100 days) when the ETA is unknown
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds <= 0 || seconds >= 8640000) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
};

export const formatPercent = (progress: number) => {
    const percent = Math.max(0, Math.min(100, progress * 100));
    return percent > 0 && percent < 10 ? `${percent.toFixed(1)}%` : `${Math.floor(percent)}%`;
};

export const STATUS_LABELS: Record<string, string> = {
    metadata: 'Fetching metadata',
    downloading: 'Downloading',
    stalled: 'Stalled',
    queued: 'Queued',
    checking: 'Checking',
    paused: 'Paused',
    completed: 'Completed',
    error: 'Error',
    missing: 'Not in qBittorrent',
    unknown: 'Unknown',
};
