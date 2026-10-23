// Android side of the page: wires shared/xivpf-core.js to the WebView bridge.
// Static game data comes from xivpf-data.js (shared with the kotlin poller), fetch
// and state go through the bridge (native HTTP has no CORS problem and the poller
// needs the same filter state), and the icon sprite is inlined because <use href>
// cannot reach a cross-origin file.

(function () {
    'use strict';

    let alertsBox = null;
    let pending = null; // the fetch in flight, settled by pfListings/pfError from kotlin

    // Android.refresh() fetches off-thread and calls one of these two
    window.pfListings = data => { if (pending) pending.resolve(data); pending = null; };
    window.pfError = message => { if (pending) pending.reject(new Error(message)); pending = null; };

    const ctx = window.xivpfInit({
        assets: 'https://xivpf.com',
        iconSprite: Android.icons(),
        loadState: () => Android.loadState(),
        saveState: json => Android.saveState(json),
        fetchListings: () => new Promise((resolve, reject) => {
            pending = { resolve, reject };
            Android.refresh();
        }),
        // the poller checks on the same interval as the page
        autoControls: ({ el }) => {
            alertsBox = el('input', { type: 'checkbox', onchange: () => Android.setPolling(alertsBox.checked) });
            alertsBox.checked = Android.polling();
            return [el('label', {}, alertsBox, document.createTextNode('alerts'))];
        },
        // pick up a poller stopped from its notification
        onRender: () => { if (alertsBox) alertsBox.checked = Android.polling(); },
    });

    // Refresh when coming back to the app
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') ctx.refresh();
    });
})();
