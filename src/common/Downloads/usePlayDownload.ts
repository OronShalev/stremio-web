// Copyright (C) 2017-2026 Smart code 203358507

import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useCore } from 'stremio/core';
import useToast from 'stremio/common/Toast/useToast';
import { getFileUrl } from './api';
import type { DownloadItem } from './types';

const episodeLabel = (item: DownloadItem) => {
    return item.video.season !== null && item.video.episode !== null ?
        `S${String(item.video.season).padStart(2, '0')}E${String(item.video.episode).padStart(2, '0')}`
        :
        null;
};

// Plays a download: completed files are played straight from disk (through the
// downloads service), unfinished ones are streamed from the torrent as usual.
const usePlayDownload = () => {
    const core = useCore();
    const navigate = useNavigate();
    const toast = useToast();

    return useCallback(async (item: DownloadItem) => {
        const local = item.status === 'completed' && item.filePath !== null;
        const name = local ? 'Downloaded' : (item.stream.addonName ?? 'Torrent');
        const description = [item.meta.name, episodeLabel(item), item.fileName].filter(Boolean).join(' · ');
        const stream = local ?
            {
                name,
                description,
                url: getFileUrl(item),
                behaviorHints: {
                    filename: item.fileName ?? undefined,
                    videoSize: item.size > 0 ? item.size : undefined,
                },
            }
            :
            {
                name,
                description,
                infoHash: item.infoHash,
                ...(item.fileIdx !== null ? { fileIdx: item.fileIdx } : {}),
                ...(item.stream.announce.length > 0 ? { announce: item.stream.announce } : {}),
            };

        try {
            const encoded = await core.transport.encodeStream(stream);
            const { type, id, metaTransportUrl } = item.meta;
            const videoId = item.video.id ?? id;
            const streamTransportUrl = item.stream.streamTransportUrl ?? metaTransportUrl;
            const path = typeof type === 'string' && typeof id === 'string' && typeof videoId === 'string' && typeof metaTransportUrl === 'string' && typeof streamTransportUrl === 'string' ?
                `/player/${[encoded, streamTransportUrl, metaTransportUrl, type, id, videoId].map((part) => encodeURIComponent(part)).join('/')}`
                :
                `/player/${encodeURIComponent(encoded)}`;
            navigate(path);
        } catch (error) {
            console.error('Failed to play download', error);
            toast.show({
                type: 'error',
                title: 'Could not play this download',
                timeout: 5000,
            });
        }
    }, [core, navigate, toast]);
};

export default usePlayDownload;
