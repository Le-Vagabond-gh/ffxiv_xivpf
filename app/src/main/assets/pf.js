// Port of ffxiv_misc/userscripts/xivpf-pf.user.js for the Android WebView.
// Differences from the userscript: static game data comes from data.json through the
// Android bridge (shared with the Kotlin poller), fetch and state go through the bridge
// (native HTTP has no CORS problem and the poller needs the same filter state), and the
// icon sprite is inlined because <use href> cannot reach a cross-origin file.

(function () {
    'use strict';

    const INTERVALS = [1, 2, 3, 5, 10, 15, 30]; // minutes

    // ---------------------------------------------------------------
    // Static game data
    // ---------------------------------------------------------------

    const DATA = JSON.parse(Android.data());
    const REGIONS = DATA.regions;
    const CATEGORIES = DATA.categories;
    const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);
    const TANKS = new Set(DATA.tanks);
    const HEALERS = new Set(DATA.healers);
    const NON_COMBAT = new Set(DATA.nonCombat);
    const DEEP_DUNGEONS = DATA.deepDungeons;

    const WORLD_TO_DC = {};
    for (const [dc, worlds] of Object.entries(DATA.dcWorlds)) {
        for (const world of worlds) {
            WORLD_TO_DC[world] = dc;
        }
    }

    function jobRole(code) {
        if (TANKS.has(code)) return 'tank';
        if (HEALERS.has(code)) return 'healer';
        if (NON_COMBAT.has(code)) return null;
        return 'dps';
    }

    // ---------------------------------------------------------------
    // Listing helpers
    // ---------------------------------------------------------------

    function dutyName(listing) {
        const info = listing.duty_info;
        const infoName = info && info.name && info.name.en;

        switch (listing.duty_type) {
            case 'Normal':
                return infoName || CATEGORY_LABEL[listing.category] || listing.category;
            case 'Roulette':
                return 'Duty Roulette';
            default:
                // "Other" duties (FATEs, hunts, maps, deep dungeons, gold saucer)
                // use their own id space that the API resolves incorrectly.
                if (listing.category === 'DeepDungeon' && infoName) {
                    const real = DEEP_DUNGEONS[infoName.toLowerCase().replace(/^the\s+/, '').trim()];
                    if (real) return real;
                }
                return CATEGORY_LABEL[listing.category] || listing.category;
        }
    }

    function descriptionFlags(listing) {
        const flags = [];
        let colour = '';
        const o = listing.objective || {};
        const c = listing.conditions || {};
        if (o.practice) { flags.push('[Practice]'); colour = 'desc-green'; }
        if (o.duty_completion) { flags.push('[Duty Completion]'); colour = 'desc-blue'; }
        if (o.loot) { flags.push('[Loot]'); colour = 'desc-yellow'; }
        if (c.duty_complete) flags.push('[Duty Complete]');
        if (c.duty_complete_reward_unclaimed) flags.push('[Duty Complete (Weekly Reward Unclaimed)]');
        if (c.duty_incomplete) flags.push('[Duty Incomplete]');
        if (listing.search_area && listing.search_area.one_player_per_job) flags.push('[One Player per Job]');
        return { colour, text: flags.join('') };
    }

    function dataCentre(listing) {
        return WORLD_TO_DC[listing.created_world.name] || 'Unknown';
    }

    function createdWorldLabel(listing) {
        // Show the data centre when more than one is visible (region or "all")
        const dcs = allowedDataCentres();
        if (dcs && dcs.size === 1) {
            return listing.created_world.name;
        }
        return `${listing.created_world.name} @ ${dataCentre(listing)}`;
    }

    function filledCount(listing) {
        return listing.slots_filled.filter(Boolean).length;
    }

    function humanDuration(seconds, future) {
        const s = Math.max(0, Math.round(seconds));
        let text;
        if (s < 45) text = `${s} seconds`;
        else if (s < 90) text = 'a minute';
        else if (s < 2700) text = `${Math.round(s / 60)} minutes`;
        else if (s < 5400) text = 'an hour';
        else text = `${Math.round(s / 3600)} hours`;
        return future ? `in ${text}` : `${text} ago`;
    }

    function clock(ms) {
        const d = new Date(ms);
        return `${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
    }

    function updatedAgo(container) {
        const at = Date.parse(container.updated_at);
        return `${humanDuration((Date.now() - at) / 1000, false)} (${clock(at)})`;
    }

    function timeLeft(container, fetchedAt) {
        // time_left is seconds remaining at fetch time
        const remaining = container.time_left - (Date.now() - fetchedAt) / 1000;
        return `${humanDuration(remaining, true)} (${clock(Date.now() + remaining * 1000)})`;
    }

    // ---------------------------------------------------------------
    // State (persisted through the bridge so the poller reads the same filters)
    // ---------------------------------------------------------------

    const state = {
        area: 'Europe',                                   // 'All' | region name | DC name
        categories: CATEGORIES.map(([key]) => key),      // allowed category keys
        search: '',
        autoRefresh: true,
        interval: 60,                                     // seconds, page refresh and poller alike
    };

    function loadState() {
        try {
            const saved = JSON.parse(Android.loadState());
            if (saved && typeof saved === 'object') {
                if (typeof saved.area === 'string') state.area = saved.area;
                if (Array.isArray(saved.categories)) state.categories = saved.categories;
                if (typeof saved.search === 'string') state.search = saved.search;
                if (typeof saved.autoRefresh === 'boolean') state.autoRefresh = saved.autoRefresh;
                if (typeof saved.interval === 'number') state.interval = saved.interval;
            }
        } catch (e) { /* ignore */ }
    }

    function saveState() {
        Android.saveState(JSON.stringify(state));
    }

    function allowedDataCentres() {
        if (state.area === 'All') return null;
        if (REGIONS[state.area]) return new Set(REGIONS[state.area]);
        return new Set([state.area]);
    }

    // ---------------------------------------------------------------
    // Page skeleton (same markup/classes as /listings so the site CSS applies)
    // ---------------------------------------------------------------

    function el(tag, attrs, ...children) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs || {})) {
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
            else node.setAttribute(key, value);
        }
        for (const child of children) {
            if (child !== null && child !== undefined) {
                node.append(child);
            }
        }
        return node;
    }

    let alertsBox = null;

    function buildPage() {
        document.body.insertAdjacentHTML('afterbegin', Android.icons());

        const areaSelect = el('select', { id: 'pf-area', onchange: () => { state.area = areaSelect.value; saveState(); render(); } },
            el('option', { value: 'All', text: 'all' }));
        for (const [region, dcs] of Object.entries(REGIONS)) {
            // optgroup labels are not selectable, so regions are plain options with their DCs indented below
            areaSelect.append(el('option', { value: region, text: region.toLowerCase() }));
            for (const dc of dcs) areaSelect.append(el('option', { value: dc, text: `   ${dc.toLowerCase()}` }));
        }
        areaSelect.value = state.area;

        const search = el('input', {
            type: 'search', class: 'search', placeholder: 'search', value: state.search,
            oninput: () => { state.search = search.value; saveState(); render(); },
        });

        const autoRefresh = el('input', {
            type: 'checkbox', onchange: () => { state.autoRefresh = autoRefresh.checked; saveState(); scheduleRefresh(); },
        });
        autoRefresh.checked = state.autoRefresh;

        const interval = el('select', { onchange: () => { state.interval = parseInt(interval.value, 10); saveState(); scheduleRefresh(); } });
        for (const m of INTERVALS) interval.append(el('option', { value: String(m * 60), text: `${m} min` }));
        if (!INTERVALS.includes(state.interval / 60)) state.interval = 60;
        interval.value = String(state.interval);

        alertsBox = el('input', { type: 'checkbox', onchange: () => Android.setPolling(alertsBox.checked) });
        alertsBox.checked = Android.polling();

        const categories = el('div', { id: 'pf-categories' });
        for (const [key, label] of CATEGORIES) {
            const box = el('input', { type: 'checkbox', value: key, onchange: () => {
                state.categories = [...categories.querySelectorAll('input:checked')].map(i => i.value);
                saveState(); render();
            } });
            box.checked = state.categories.includes(key);
            categories.append(el('label', {}, box, document.createTextNode(label)));
        }
        const setAll = on => {
            categories.querySelectorAll('input').forEach(i => { i.checked = on; });
            state.categories = on ? CATEGORIES.map(([k]) => k) : [];
            saveState(); render();
        };

        document.body.append(
            el('nav', { class: 'container' },
                el('ul', {}, el('li', {}, el('strong', { class: 'contrast', text: 'xivpf' }))),
            ),
            el('div', { class: 'container' },
                el('div', { id: 'container' },
                    el('div', { class: 'requires-js settings' },
                        el('div', { class: 'controls' },
                            search,
                            areaSelect,
                            el('label', {}, autoRefresh, document.createTextNode('auto-refresh')),
                            el('a', { href: 'javascript:void(0)', text: 'refresh', onclick: () => refresh() }),
                            el('label', {}, document.createTextNode('every'), interval),
                            el('label', {}, alertsBox, document.createTextNode('alerts')),
                            el('span', { id: 'pf-status', text: 'loading...' }),
                        ),
                        el('div', {},
                            el('details', { class: 'filter-controls' },
                                el('summary', { text: 'categories' }),
                                el('div', {},
                                    el('div', { class: 'control' }, categories),
                                    el('div', { class: 'pf-cat-buttons' },
                                        el('a', { text: 'all', onclick: () => setAll(true) }),
                                        el('a', { text: 'none', onclick: () => setAll(false) }),
                                    ),
                                ),
                            ),
                        ),
                    ),
                    el('div', { id: 'listings', class: 'list' }),
                ),
            ),
        );
    }

    // ---------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------

    let containers = [];
    let fetchedAt = 0;
    let refreshTimer = null;

    function slotIcon(code) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 32 32');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `#${code}`);
        svg.append(use);
        return svg;
    }

    function metaItem(cls, text, title, icon, href) {
        const label = href
            ? el('a', { class: 'text', href, target: '_blank', rel: 'noopener', text })
            : el('span', { class: 'text', text });
        return el('div', { class: `item ${cls}` },
            label,
            el('span', { title }, (() => { const s = slotIcon(icon); s.setAttribute('class', 'icon'); return s; })()),
        );
    }

    function renderRow(container) {
        const l = container.listing;
        const flags = descriptionFlags(l);
        const desc = (l.description.en || '').trim();
        const description = el('div', { class: 'description' });
        if (!desc && !flags.text) {
            description.append(el('em', { text: 'None' }));
        } else {
            if (flags.text) description.append(el('span', { class: flags.colour, text: `${flags.text} ` }));
            description.append(document.createTextNode(desc));
        }

        const party = el('div', { class: 'party' });
        const slotCount = Math.min(l.slot_count, l.slots.length);
        for (let i = 0; i < slotCount; i++) {
            const filled = l.slots_filled[i];
            if (filled) {
                const role = jobRole(filled);
                party.append(el('div', { class: `slot filled${role ? ' ' + role : ''}`, title: filled }, slotIcon(filled)));
            } else {
                const jobs = l.slots[i] || [];
                const roles = new Set(jobs.map(jobRole).filter(Boolean));
                const cls = jobs.length >= 31 ? 'empty' : ['healer', 'tank', 'dps'].filter(r => roles.has(r)).join(' ');
                party.append(el('div', { class: `slot ${cls}`, title: jobs.join(' ') }));
            }
        }
        party.append(el('div', { class: 'total', text: `${filledCount(l)}/${l.slot_count}` }));

        const cross = l.search_area && l.search_area.data_centre;
        return el('div', {
            class: 'listing',
            'data-id': l.id,
            'data-centre': dataCentre(l),
            'data-pf-category': l.category,
        },
            el('div', { class: 'left' },
                el('div', { class: `duty ${cross ? 'cross' : 'local'}`, text: dutyName(l) }),
                description,
                party,
            ),
            el('div', { class: 'middle' },
                el('div', { class: 'stat' },
                    el('div', { class: 'name', text: 'Min IL' }),
                    el('div', { class: 'value', text: String(l.min_item_level) }),
                ),
            ),
            el('div', { class: 'right meta' },
                metaItem('creator', `${l.recruiter} @ ${l.home_world.name}`, 'Creator', 'user',
                    `https://tomestone.gg/character-name/${encodeURIComponent(l.home_world.name)}/${encodeURIComponent(l.recruiter)}`),
                metaItem('world', createdWorldLabel(l), 'Created on', 'sphere'),
                metaItem('expires', timeLeft(container, fetchedAt), 'Expires', 'stopwatch'),
                metaItem('updated', updatedAgo(container), 'Updated', 'clock'),
            ),
        );
    }

    // Must stay in step with Listings.Filter.matches() on the Kotlin side.
    function matches(container) {
        const l = container.listing;
        const dcs = allowedDataCentres();
        if (dcs && !dcs.has(dataCentre(l))) return false;
        if (!state.categories.includes(l.category)) return false;
        if (state.search) {
            const needle = state.search.toLowerCase();
            const haystack = [dutyName(l), l.description.en, l.recruiter, l.created_world.name, l.home_world.name]
                .join(' ').toLowerCase();
            if (!haystack.includes(needle)) return false;
        }
        return true;
    }

    function setStatus(text) {
        const status = document.getElementById('pf-status');
        if (status) status.textContent = text;
    }

    function render() {
        const listings = document.getElementById('listings');
        if (!listings) return;
        const shown = containers.filter(matches);
        listings.replaceChildren(...shown.map(renderRow));
        if (shown.length === 0) {
            listings.append(el('em', { class: 'no-listings', text: containers.length ? 'No listings match the current filter.' : 'No listings.' }));
        }
        setStatus(`${shown.length} / ${containers.length} listings, updated ${new Date(fetchedAt).toLocaleTimeString()}`);
        if (alertsBox) alertsBox.checked = Android.polling();
    }

    // ---------------------------------------------------------------
    // Data (Android.refresh() fetches off-thread and calls one of the two callbacks)
    // ---------------------------------------------------------------

    function refresh() {
        setStatus('loading...');
        Android.refresh();
    }

    window.pfListings = data => {
        fetchedAt = Date.now();
        containers = data
            .filter(c => c && c.listing)
            .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
        render();
        scheduleRefresh();
    };

    window.pfError = message => {
        console.error('[xivpf] refresh failed', message);
        setStatus(`refresh failed: ${message}`);
        scheduleRefresh();
    };

    function scheduleRefresh() {
        clearTimeout(refreshTimer);
        if (state.autoRefresh) {
            refreshTimer = setTimeout(refresh, state.interval * 1000);
        }
    }

    // Refresh when coming back to the app, and pick up a poller stopped from its notification.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refresh();
    });

    loadState();
    buildPage();
    refresh();
})();
