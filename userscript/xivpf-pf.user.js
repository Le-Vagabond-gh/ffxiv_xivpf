// ==UserScript==
// @name         xivpf - lightweight party finder page
// @namespace    com.levagabond.xivpf
// @version      1.8.0
// @description  Replaces https://xivpf.com/pf with a page built from /api/listings: region/DC, category and duty filters, text search, auto-refresh, real deep dungeon names.
// @updateURL    https://raw.githubusercontent.com/Le-Vagabond-gh/ffxiv_xivpf/main/userscript/xivpf-pf.user.js
// @downloadURL  https://raw.githubusercontent.com/Le-Vagabond-gh/ffxiv_xivpf/main/userscript/xivpf-pf.user.js
// @require      https://raw.githubusercontent.com/Le-Vagabond-gh/ffxiv_xivpf/main/shared/xivpf-data.js
// @require      https://raw.githubusercontent.com/Le-Vagabond-gh/ffxiv_xivpf/main/shared/xivpf-core.js
// @match        https://xivpf.com/pf
// @match        https://xivpf.com/pf?*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// Why a userscript and not a plain .html file: /api/listings sends no CORS
// headers, so the JSON can only be fetched from a page on xivpf.com itself.
// /pf is an unused path (the server answers 405 with 23 bytes), which we take
// over at document-start. The site's own stylesheets are reused so the rows
// look identical to /listings. The page itself is shared/xivpf-core.js, this
// file only wires it to the browser.

(function () {
    'use strict';

    const STORAGE_KEY = 'pf-userscript-state';

    window.xivpfInit({
        assets: '',
        homeHref: '/pf',
        loadState: () => localStorage.getItem(STORAGE_KEY),
        saveState: json => localStorage.setItem(STORAGE_KEY, json),
        fetchListings: async () => {
            const response = await fetch('/api/listings', { credentials: 'omit', cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        },
        navItems: ({ el }) => [el('li', {}, el('a', { href: '/listings', text: 'full site' }))],
    });
})();
