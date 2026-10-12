// Copyright (C) 2017-2026 Smart code 203358507

import { useSyncExternalStore } from 'react';
import { actions, getSnapshot, subscribe } from './store';

const useDownloads = () => {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return { ...state, actions };
};

export default useDownloads;
