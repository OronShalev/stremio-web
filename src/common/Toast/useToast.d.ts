type ToastOptions = {
    type: string,
    title: string,
    message?: string,
    timeout: number,
};

declare const useToast: () => {
    show: (options: ToastOptions) => void,
};

export = useToast;
