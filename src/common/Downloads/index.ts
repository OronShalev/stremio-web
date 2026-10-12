// Copyright (C) 2017-2026 Smart code 203358507

import useDownloads from './useDownloads';
import useStreamDownload, { findDownloadForStream } from './useStreamDownload';
import usePlayDownload from './usePlayDownload';
import { getServiceUrl, DEFAULT_SERVICE_URL } from './api';
import { formatBytes, formatSpeed, formatEta, formatPercent, STATUS_LABELS } from './format';

export type { DownloadItem, DownloadStatus, DownloadsState, DownloadContext, DownloadableStream } from './types';

export {
    useDownloads,
    useStreamDownload,
    usePlayDownload,
    findDownloadForStream,
    getServiceUrl,
    DEFAULT_SERVICE_URL,
    formatBytes,
    formatSpeed,
    formatEta,
    formatPercent,
    STATUS_LABELS,
};
