// Copyright (C) 2017-2026 Smart code 203358507

import React, { useCallback, useState } from 'react';
import classnames from 'classnames';
import Icon from '@stremio/stremio-icons/react';
import { Button } from 'stremio/components';
import { formatBytes, formatEta, formatPercent, formatSpeed, STATUS_LABELS } from 'stremio/common/Downloads';
import type { DownloadItem } from 'stremio/common/Downloads';
import styles from './DownloadRow.less';

type Props = {
    item: DownloadItem,
    onPlay: (item: DownloadItem) => void,
    onPause: (item: DownloadItem) => void,
    onResume: (item: DownloadItem) => void,
    onReveal: (item: DownloadItem) => void,
    onDelete: (item: DownloadItem) => void,
};

const ACTIVE = new Set(['metadata', 'downloading', 'stalled', 'queued', 'checking']);
const RESUMABLE = new Set(['paused', 'missing', 'error']);

const episodeLabel = (item: DownloadItem) => {
    if (item.video.season !== null && item.video.episode !== null) {
        return `S${String(item.video.season).padStart(2, '0')}E${String(item.video.episode).padStart(2, '0')}`;
    }
    return null;
};

const DownloadRow = ({ item, onPlay, onPause, onResume, onReveal, onDelete }: Props) => {
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const completed = item.status === 'completed';
    const active = ACTIVE.has(item.status);
    const episode = episodeLabel(item);
    const eta = active ? formatEta(item.torrent?.eta) : null;

    const title = episode !== null ?
        [episode, item.video.title].filter(Boolean).join(' · ')
        :
        item.fileName ?? item.meta.name ?? item.torrent?.name ?? item.infoHash;
    const showFileName = episode !== null && typeof item.fileName === 'string';

    const details = completed ?
        [formatBytes(item.size)]
        :
        [
            `${formatBytes(item.downloaded)} / ${item.size > 0 ? formatBytes(item.size) : '?'}`,
            active && item.torrent ? `↓ ${formatSpeed(item.torrent.dlspeed)}` : null,
            eta ? `${eta} left` : null,
            active && item.torrent ? `${item.torrent.seeds} seeds · ${item.torrent.peers} peers` : null,
        ];

    const play = useCallback(() => onPlay(item), [item, onPlay]);
    const pause = useCallback(() => onPause(item), [item, onPause]);
    const resume = useCallback(() => onResume(item), [item, onResume]);
    const reveal = useCallback(() => onReveal(item), [item, onReveal]);
    const askDelete = useCallback(() => setConfirmingDelete(true), []);
    const cancelDelete = useCallback(() => setConfirmingDelete(false), []);
    const confirmDelete = useCallback(() => {
        setConfirmingDelete(false);
        onDelete(item);
    }, [item, onDelete]);

    return (
        <div className={classnames(styles['download-row'], styles[item.status])}>
            <Button className={styles['play-area']} title={completed ? 'Watch' : 'Stream while downloading'} onClick={play}>
                <div className={styles['info']}>
                    <div className={styles['title']}>{title}</div>
                    {
                        showFileName ?
                            <div className={styles['file-name']} title={item.filePath ?? item.fileName ?? ''}>{item.fileName}</div>
                            :
                            null
                    }
                    <div className={styles['progress-container']}>
                        <div className={styles['progress-bar']}>
                            <div className={styles['progress-fill']} style={{ width: `${Math.max(0, Math.min(1, item.progress)) * 100}%` }} />
                        </div>
                        <div className={styles['progress-label']}>{formatPercent(item.progress)}</div>
                    </div>
                    <div className={styles['details']}>
                        <span className={styles['status']}>{STATUS_LABELS[item.status] ?? item.status}</span>
                        {details.filter(Boolean).map((detail, index) => (
                            <span key={index} className={styles['detail']}>{detail}</span>
                        ))}
                    </div>
                </div>
            </Button>
            <div className={styles['actions']}>
                {
                    confirmingDelete ?
                        <React.Fragment>
                            <div className={styles['confirm-label']}>Delete files from disk?</div>
                            <Button className={classnames(styles['action'], styles['danger'], styles['wide'])} title={'Delete'} onClick={confirmDelete}>
                                <Icon className={styles['action-icon']} name={'bin'} />
                                <div className={styles['action-label']}>Delete</div>
                            </Button>
                            <Button className={classnames(styles['action'], styles['wide'])} title={'Cancel'} onClick={cancelDelete}>
                                <div className={styles['action-label']}>Cancel</div>
                            </Button>
                        </React.Fragment>
                        :
                        <React.Fragment>
                            <Button className={classnames(styles['action'], styles['primary'])} title={completed ? 'Watch' : 'Stream while downloading'} onClick={play}>
                                <Icon className={styles['action-icon']} name={'play'} />
                            </Button>
                            {
                                active ?
                                    <Button className={styles['action']} title={'Pause'} onClick={pause}>
                                        <Icon className={styles['action-icon']} name={'pause'} />
                                    </Button>
                                    :
                                    RESUMABLE.has(item.status) ?
                                        <Button className={styles['action']} title={item.status === 'paused' ? 'Resume' : 'Retry / continue download'} onClick={resume}>
                                            <Icon className={styles['action-icon']} name={item.status === 'paused' ? 'download' : 'reset'} />
                                        </Button>
                                        :
                                        null
                            }
                            <Button className={styles['action']} title={'Show in folder'} onClick={reveal}>
                                <Icon className={styles['action-icon']} name={'open-in-browser'} />
                            </Button>
                            <Button className={styles['action']} title={'Delete'} onClick={askDelete}>
                                <Icon className={styles['action-icon']} name={'bin'} />
                            </Button>
                        </React.Fragment>
                }
            </div>
        </div>
    );
};

export default DownloadRow;
