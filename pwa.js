// Updates wait for all app tabs to close; never reload a learning session automatically.
window.addEventListener('load', async () => {
    if (!('serviceWorker' in navigator)) return;
    const status = document.getElementById('appUpdateStatus');
    const showUpdate = () => {
        if (status) status.textContent = '新しいバージョンがあります。学習を終えて、このアプリのタブとホーム画面アプリをすべて閉じてから開き直してください。';
    };
    try {
        const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
        if (registration.waiting) showUpdate();
        registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (worker) worker.addEventListener('statechange', () => {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
            });
        });
    } catch (_) {
        if (status) status.textContent = 'オフライン用の準備ができませんでした。通信状態を確認して開き直してください。オンラインでの学習は続けられます。';
    }
});
