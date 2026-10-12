// Copyright (C) 2017-2026 Smart code 203358507

import React, { useCallback } from 'react';
import classnames from 'classnames';
import { useNavigate } from 'react-router';
import Icon from '@stremio/stremio-icons/react';
import { formatPercent, STATUS_LABELS } from 'stremio/common/Downloads';
import type { DownloadItem } from 'stremio/common/Downloads';
import styles from './DownloadButton.less';

type Props = {
    className?: string,
    item: DownloadItem | null,
    starting: boolean,
    onStart: () => void,
};

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Prevent the click / key press from reaching the stream row (which would start playback)
const stopRowEvent = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const native = event.nativeEvent as Event & { togglePopupPrevented?: boolean, buttonClickPrevented?: boolean };
    native.togglePopupPrevented = true;
    native.buttonClickPrevented = true;
};

const DownloadButton = ({ className, item, starting, onStart }: Props) => {
    const navigate = useNavigate();

    const activate = useCallback(() => {
        if (item !== null) {
            navigate('/downloads');
        } else {
            onStart();
        }
    }, [item, onStart, navigate]);

    const onClick = useCallback((event: React.MouseEvent) => {
        stopRowEvent(event);
        activate();
    }, [activate]);

    const onKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
            stopRowEvent(event);
            activate();
        }
    }, [activate]);

    const onMouseDown = useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
    }, []);

    const completed = item !== null && item.status === 'completed';
    const active = item !== null && !completed;
    const progress = item !== null ? Math.max(0, Math.min(1, item.progress)) : 0;
    const title = starting ?
        'Starting download…'
        :
        item === null ?
            'Download'
            :
            completed ?
                'Downloaded - open downloads'
                :
                `${STATUS_LABELS[item.status] ?? item.status} ${formatPercent(progress)} - open downloads`;

    return (
        <div
            className={classnames(className, styles['download-button'], {
                [styles['active']]: active || starting,
                [styles['completed']]: completed,
                [styles['paused']]: item !== null && item.status === 'paused',
                [styles['error']]: item !== null && (item.status === 'error' || item.status === 'missing'),
            })}
            role={'button'}
            tabIndex={0}
            title={title}
            aria-label={title}
            onClick={onClick}
            onKeyDown={onKeyDown}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseDown}
            onPointerDown={onMouseDown}
        >
            {
                active || starting ?
                    <React.Fragment>
                        <svg className={classnames(styles['ring'], { [styles['spinning']]: starting || item?.status === 'metadata' })} viewBox={'0 0 36 36'}>
                            <circle className={styles['ring-track']} cx={18} cy={18} r={RADIUS} />
                            <circle
                                className={styles['ring-progress']}
                                cx={18}
                                cy={18}
                                r={RADIUS}
                                strokeDasharray={CIRCUMFERENCE}
                                strokeDashoffset={starting || item?.status === 'metadata' ? CIRCUMFERENCE * 0.75 : CIRCUMFERENCE * (1 - progress)}
                            />
                        </svg>
                        <div className={styles['percent']}>
                            {item !== null && item.status !== 'metadata' ? formatPercent(progress) : ''}
                        </div>
                    </React.Fragment>
                    :
                    <Icon className={styles['icon']} name={completed ? 'checkmark' : 'download'} />
            }
        </div>
    );
};

export default DownloadButton;
