// Copyright (C) 2017-2026 Smart code 203358507

import React, { useCallback, useMemo, useState } from 'react';
import classnames from 'classnames';
import { useNavigate, useParams } from 'react-router';
import Icon from '@stremio/stremio-icons/react';
import { useToast } from 'stremio/common';
import { Button, Chips, Image, MainNavBars } from 'stremio/components';
import { useDownloads, usePlayDownload, formatBytes, formatSpeed, getServiceUrl } from 'stremio/common/Downloads';
import type { DownloadItem } from 'stremio/common/Downloads';
import DownloadRow from './DownloadRow';
import styles from './Downloads.less';

const FILTERS = ['all', 'downloading', 'paused', 'completed', 'problems'] as const;
type Filter = typeof FILTERS[number];

const FILTER_LABELS: Record<Filter, string> = {
    all: 'All',
    downloading: 'In progress',
    paused: 'Paused',
    completed: 'Completed',
    problems: 'Problems',
};

const matchesFilter = (item: DownloadItem, filter: Filter) => {
    switch (filter) {
        case 'downloading':
            return ['metadata', 'downloading', 'stalled', 'queued', 'checking'].includes(item.status);
        case 'paused':
            return item.status === 'paused';
        case 'completed':
            return item.status === 'completed';
        case 'problems':
            return ['error', 'missing', 'unknown'].includes(item.status);
        default:
            return true;
    }
};

type Group = {
    key: string,
    name: string,
    type: string | null,
    metaId: string | null,
    poster: string | null,
    items: DownloadItem[],
    size: number,
    latest: number,
};

const groupItems = (items: DownloadItem[]): Group[] => {
    const groups = new Map<string, Group>();
    items.forEach((item) => {
        const key = item.meta.id ?? item.meta.name ?? item.infoHash;
        const group = groups.get(key) ?? {
            key,
            name: item.meta.name ?? item.torrent?.name ?? item.fileName ?? item.infoHash,
            type: item.meta.type,
            metaId: item.meta.id,
            poster: item.meta.poster,
            items: [],
            size: 0,
            latest: 0,
        };
        group.items.push(item);
        group.size += item.size;
        group.latest = Math.max(group.latest, item.addedAt ? Date.parse(item.addedAt) || 0 : 0);
        groups.set(key, group);
    });

    return Array.from(groups.values())
        .map((group) => ({
            ...group,
            items: group.items.slice().sort((a, b) => {
                return ((a.video.season ?? 0) - (b.video.season ?? 0)) ||
                    ((a.video.episode ?? 0) - (b.video.episode ?? 0)) ||
                    (a.fileName ?? '').localeCompare(b.fileName ?? '');
            }),
        }))
        .sort((a, b) => b.latest - a.latest);
};

const Downloads = () => {
    const { filter: filterParam } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const downloads = useDownloads();
    const playDownload = usePlayDownload();
    const [search, setSearch] = useState('');

    const filter: Filter = FILTERS.includes(filterParam as Filter) ? filterParam as Filter : 'all';

    const counts = useMemo(() => {
        return FILTERS.reduce((result, key) => {
            result[key] = downloads.items.filter((item) => matchesFilter(item, key)).length;
            return result;
        }, {} as Record<Filter, number>);
    }, [downloads.items]);

    const chipOptions = useMemo(() => {
        return FILTERS
            .filter((key) => key !== 'problems' || counts.problems > 0)
            .map((key) => ({ value: key, label: `${FILTER_LABELS[key]} (${counts[key]})` }));
    }, [counts]);

    const onFilterSelect = useCallback((value: string) => {
        navigate(value === 'all' ? '/downloads' : `/downloads/${value}`, { replace: true });
        return {};
    }, [navigate]);

    const groups = useMemo(() => {
        const query = search.trim().toLowerCase();
        const filtered = downloads.items.filter((item) => {
            if (!matchesFilter(item, filter)) return false;
            if (query.length === 0) return true;
            return [item.meta.name, item.fileName, item.video.title, item.torrent?.name]
                .some((value) => typeof value === 'string' && value.toLowerCase().includes(query));
        });
        return groupItems(filtered);
    }, [downloads.items, filter, search]);

    const stats = useMemo(() => {
        const active = downloads.items.filter((item) => matchesFilter(item, 'downloading'));
        // Several items can share a torrent - count each torrent's speed once
        const speeds = new Map<string, number>();
        active.forEach((item) => speeds.set(item.infoHash, item.torrent?.dlspeed ?? 0));
        return {
            totalSize: downloads.items.reduce((sum, item) => sum + item.downloaded, 0),
            speed: Array.from(speeds.values()).reduce((sum, value) => sum + value, 0),
            active: active.length,
        };
    }, [downloads.items]);

    const showError = useCallback((title: string) => (error: unknown) => {
        toast.show({
            type: 'error',
            title,
            message: error instanceof Error ? error.message : String(error),
            timeout: 5000,
        });
    }, [toast]);

    const onPlay = useCallback((item: DownloadItem) => {
        playDownload(item);
    }, [playDownload]);
    const onPause = useCallback((item: DownloadItem) => {
        downloads.actions.pause(item.id).catch(showError('Could not pause download'));
    }, [downloads.actions, showError]);
    const onResume = useCallback((item: DownloadItem) => {
        downloads.actions.resume(item.id).catch(showError('Could not resume download'));
    }, [downloads.actions, showError]);
    const onReveal = useCallback((item: DownloadItem) => {
        downloads.actions.reveal(item.id).catch(showError('Could not open folder'));
    }, [downloads.actions, showError]);
    const onDelete = useCallback((item: DownloadItem) => {
        downloads.actions.remove(item.id)
            .then(() => {
                toast.show({ type: 'success', title: 'Download deleted', timeout: 3000 });
            })
            .catch(showError('Could not delete download'));
    }, [downloads.actions, showError, toast]);
    const onSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setSearch(event.target.value);
    }, []);
    const onRetry = useCallback(() => {
        downloads.actions.refresh();
    }, [downloads.actions]);

    const renderPosterFallback = useCallback((type: string | null) => () => (
        <div className={styles['poster-fallback']}>
            <Icon className={styles['poster-fallback-icon']} name={type === 'movie' ? 'movies' : type === 'series' ? 'series' : 'download'} />
        </div>
    ), []);

    return (
        <MainNavBars className={styles['downloads-container']} route={'downloads'}>
            <div className={classnames(styles['downloads-content'], 'animation-fade-in')}>
                <div className={styles['header']}>
                    <div className={styles['heading']}>
                        <div className={styles['title']}>Downloads</div>
                        {
                            downloads.status === 'ready' ?
                                <div className={styles['summary']}>
                                    <span>{formatBytes(stats.totalSize)} on disk</span>
                                    {stats.active > 0 ? <span>{stats.active} downloading · ↓ {formatSpeed(stats.speed)}</span> : null}
                                    {downloads.freeSpace !== null ? <span>{formatBytes(downloads.freeSpace)} free</span> : null}
                                    {downloads.downloadsDir ? <span className={styles['folder']} title={downloads.downloadsDir}>{downloads.downloadsDir}</span> : null}
                                </div>
                                :
                                null
                        }
                    </div>
                    {
                        downloads.items.length > 0 ?
                            <div className={styles['search-container']}>
                                <Icon className={styles['search-icon']} name={'search'} />
                                <input
                                    className={styles['search-input']}
                                    type={'text'}
                                    placeholder={'Search downloads'}
                                    value={search}
                                    onChange={onSearchChange}
                                />
                            </div>
                            :
                            null
                    }
                </div>
                {
                    downloads.items.length > 0 ?
                        <div className={styles['filters']}>
                            <Chips options={chipOptions} selected={[filter]} onSelect={onFilterSelect} />
                        </div>
                        :
                        null
                }
                {
                    downloads.status === 'offline' ?
                        <div className={classnames(styles['banner'], styles['danger'])}>
                            <Icon className={styles['banner-icon']} name={'warning'} />
                            <div className={styles['banner-text']}>
                                <div className={styles['banner-title']}>The downloads service is not running</div>
                                <div className={styles['banner-message']}>
                                    Start it from the stremio-web folder with <code>pnpm downloads-service</code> (or run <code>downloads-service\start.cmd</code>).
                                    It talks to qBittorrent on localhost:8090 and is expected at <code>{getServiceUrl()}</code>.
                                </div>
                            </div>
                            <Button className={styles['banner-button']} title={'Retry'} onClick={onRetry}>Retry</Button>
                        </div>
                        :
                        null
                }
                {
                    downloads.status === 'ready' && !downloads.qbittorrent.online ?
                        <div className={styles['banner']}>
                            <Icon className={styles['banner-icon']} name={'warning'} />
                            <div className={styles['banner-text']}>
                                <div className={styles['banner-title']}>qBittorrent is not reachable</div>
                                <div className={styles['banner-message']}>
                                    {downloads.qbittorrent.error ?? `Check that the qBittorrent Web UI is enabled at ${downloads.qbittorrent.url}.`} Files already on disk can still be watched and deleted.
                                </div>
                            </div>
                            <Button className={styles['banner-button']} title={'Retry'} onClick={onRetry}>Retry</Button>
                        </div>
                        :
                        null
                }
                <div className={styles['groups']}>
                    {
                        downloads.status === 'loading' || downloads.status === 'idle' ?
                            <div className={styles['message-container']}>
                                <div className={styles['message-label']}>Loading downloads…</div>
                            </div>
                            :
                            downloads.status === 'ready' && downloads.items.length === 0 ?
                                <div className={styles['message-container']}>
                                    <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                                    <div className={styles['message-label']}>No downloads yet</div>
                                    <div className={styles['message-hint']}>
                                        Open a movie or an episode and press the <Icon className={styles['inline-icon']} name={'download'} /> button next to a stream to download it.
                                    </div>
                                </div>
                                :
                                downloads.status === 'ready' && groups.length === 0 ?
                                    <div className={styles['message-container']}>
                                        <div className={styles['message-label']}>Nothing here</div>
                                    </div>
                                    :
                                    groups.map((group) => (
                                        <div key={group.key} className={styles['group']}>
                                            <div className={styles['group-header']}>
                                                <Button
                                                    className={styles['group-poster']}
                                                    title={group.name}
                                                    href={group.type && group.metaId ? `#/detail/${encodeURIComponent(group.type)}/${encodeURIComponent(group.metaId)}` : undefined}
                                                    tabIndex={-1}
                                                >
                                                    <Image
                                                        className={styles['poster-image']}
                                                        src={group.poster ?? undefined}
                                                        alt={' '}
                                                        renderFallback={renderPosterFallback(group.type)}
                                                    />
                                                </Button>
                                                <div className={styles['group-info']}>
                                                    <div className={styles['group-name']} title={group.name}>{group.name}</div>
                                                    <div className={styles['group-meta']}>
                                                        {[
                                                            group.type === 'movie' ? 'Movie' : group.type === 'series' ? 'Series' : group.type,
                                                            group.type === 'series' ? `${group.items.length} episode${group.items.length === 1 ? '' : 's'}` : (group.items.length > 1 ? `${group.items.length} files` : null),
                                                            formatBytes(group.size),
                                                        ].filter(Boolean).join(' · ')}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className={styles['group-items']}>
                                                {group.items.map((item) => (
                                                    <DownloadRow
                                                        key={item.id}
                                                        item={item}
                                                        onPlay={onPlay}
                                                        onPause={onPause}
                                                        onResume={onResume}
                                                        onReveal={onReveal}
                                                        onDelete={onDelete}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    ))
                    }
                </div>
            </div>
        </MainNavBars>
    );
};

export default Downloads;
