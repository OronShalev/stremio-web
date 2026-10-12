// Copyright (C) 2017-2026 Smart code 203358507

import { useCallback, useMemo, useState } from 'react';
import useToast from 'stremio/common/Toast/useToast';
import useDownloads from './useDownloads';
import type { DownloadableStream, DownloadContext, DownloadItem } from './types';

const isInfoHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);

// Find the download (if any) that corresponds to a stream of a given video
export const findDownloadForStream = (items: DownloadItem[], stream: DownloadableStream, context: DownloadContext | null) => {
    if (!isInfoHash(stream.infoHash)) return null;
    const hash = stream.infoHash.toLowerCase();
    const sameTorrent = items.filter((item) => item.infoHash === hash);
    if (sameTorrent.length === 0) return null;
    if (typeof stream.fileIdx === 'number') {
        const byFile = sameTorrent.find((item) => item.fileIdx === stream.fileIdx);
        if (byFile) return byFile;
    }
    const videoId = context?.video.id ?? null;
    if (videoId !== null) {
        const byVideo = sameTorrent.find((item) => item.video.id === videoId && (item.fileIdx === null || typeof stream.fileIdx !== 'number'));
        if (byVideo) return byVideo;
    }
    return typeof stream.fileIdx !== 'number' && sameTorrent.length === 1 ? sameTorrent[0] : null;
};

const useStreamDownload = (stream: DownloadableStream | null, context: DownloadContext | null) => {
    const toast = useToast();
    const downloads = useDownloads();
    const [starting, setStarting] = useState(false);

    const available = stream !== null && isInfoHash(stream.infoHash);

    const item = useMemo(() => {
        return available ? findDownloadForStream(downloads.items, stream, context) : null;
    }, [available, downloads.items, stream, context]);

    const start = useCallback(async () => {
        if (!available || stream === null || !isInfoHash(stream.infoHash) || starting) return;

        if (downloads.status === 'offline') {
            toast.show({
                type: 'error',
                title: 'Downloads service is not running',
                message: 'Start it with "pnpm downloads-service" and make sure qBittorrent is running.',
                timeout: 6000,
            });
            return;
        }

        setStarting(true);
        try {
            const announce = Array.isArray(stream.announce) ? stream.announce : Array.isArray(stream.sources) ? stream.sources : [];
            await downloads.actions.add({
                infoHash: stream.infoHash.toLowerCase(),
                fileIdx: typeof stream.fileIdx === 'number' ? stream.fileIdx : null,
                magnet: stream.deepLinks?.externalPlayer?.magnet ?? null,
                announce,
                meta: context?.meta ?? { type: null, id: null, name: stream.title ?? stream.name ?? null, poster: null, background: null, logo: null, metaTransportUrl: null },
                video: context?.video ?? { id: null, season: null, episode: null, title: null },
                stream: {
                    name: stream.name ?? null,
                    description: stream.description ?? stream.title ?? null,
                    addonName: stream.addonName ?? null,
                    streamTransportUrl: stream.addonTransportUrl ?? null,
                },
            });
            toast.show({
                type: 'success',
                title: 'Download started',
                message: context?.meta.name ?? undefined,
                timeout: 3000,
            });
        } catch (error) {
            toast.show({
                type: 'error',
                title: 'Could not start download',
                message: error instanceof Error ? error.message : String(error),
                timeout: 6000,
            });
        } finally {
            setStarting(false);
        }
    }, [available, stream, context, starting, downloads.status, downloads.actions, toast]);

    return { available, item, starting, start, serviceStatus: downloads.status };
};

export default useStreamDownload;
