// Everything the party finder page does that is not platform specific. The
// userscript and the android WebView each call window.xivpfInit(platform) with:
//   loadState()       -> saved state as a json string (or null)
//   saveState(json)
//   fetchListings()   -> Promise of the /api/listings array
//   assets            -> prefix for the site's css/icons ('' on xivpf.com itself)
//   iconSprite        -> optional: the icons.svg markup to inline when <use href>
//                        cannot reach the site's file (android)
//   homeHref          -> optional: makes the "xivpf" brand a link
//   navItems(ctx)     -> optional: extra <li> for the nav bar, before the common ones
//   autoControls(ctx) -> optional: extra elements for the "every N min" row under the
//                        nav bar, which is only shown while auto-refresh is on
//   onRender(ctx)     -> optional: called after every render
// Needs window.XIVPF_DATA (xivpf-data.js) loaded first. Returns ctx:
//   { el, state, saveState, render, refresh, scheduleRefresh }

window.xivpfInit = function (platform) {
    'use strict';

    // ---------------------------------------------------------------
    // Static game data
    // ---------------------------------------------------------------

    const DATA = window.XIVPF_DATA;
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

    function humanDuration(seconds) {
        const s = Math.max(0, Math.round(seconds));
        let text;
        if (s < 45) text = `${s} seconds`;
        else if (s < 90) text = 'a minute';
        else if (s < 2700) text = `${Math.round(s / 60)} minutes`;
        else if (s < 5400) text = 'an hour';
        else text = `${Math.round(s / 3600)} hours`;
        return `${text} ago`;
    }

    function clock(ms) {
        const d = new Date(ms);
        return `${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
    }

    function updatedAgo(container) {
        const at = Date.parse(container.updated_at);
        return `${humanDuration((Date.now() - at) / 1000)} (${clock(at)})`;
    }

    // ---------------------------------------------------------------
    // State
    // ---------------------------------------------------------------

    // /api/listings is the whole board, ~1.5 MB uncompressed with no server-side
    // filter, so the refresh interval is the only thing that keeps traffic down
    const INTERVALS = [1, 2, 3, 5, 10, 15, 30]; // minutes

    const state = {
        area: 'Europe',                                   // 'All' | region name | DC name
        categories: CATEGORIES.map(([key]) => key),      // allowed category keys
        duties: [],                                       // dutyName()s to show, empty = all
        search: '',
        autoRefresh: true,
        interval: 300,                                    // seconds between refreshes
    };

    function loadState() {
        try {
            const saved = JSON.parse(platform.loadState());
            if (saved && typeof saved === 'object') {
                // a saved field is taken when it has the same shape as its default
                for (const key of Object.keys(state)) {
                    const v = saved[key];
                    if (typeof v === typeof state[key] && Array.isArray(v) === Array.isArray(state[key])) state[key] = v;
                }
            }
        } catch (e) { /* ignore */ }
    }

    function saveState() {
        try {
            platform.saveState(JSON.stringify(state));
        } catch (e) { /* ignore */ }
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

    const ctx = { el, state, saveState, render, refresh, scheduleRefresh };

    function buildPage() {
        document.documentElement.lang = 'en';
        document.documentElement.className = 'js';
        document.documentElement.dataset.theme = 'dark';

        const head = document.createElement('head');
        head.append(
            el('meta', { charset: 'utf-8' }),
            el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
            el('title', { text: 'xivpf - pf' }),
            ...['minireset', 'pico', 'common', 'listings'].map(name =>
                el('link', { rel: 'stylesheet', href: `${platform.assets}/assets/${name}.css` })),
            el('style', { text: `
                #pf-status { color: var(--meta-text); margin-left: 1em; white-space: nowrap; }
                /* the site grid is 3fr auto 2fr for left / min IL / meta; without the middle column the meta block would sit in the auto slot */
                @media (min-width: 50em) { #listings > .listing { grid-template-columns: 3fr 2fr; } }
                .pf-checks { display: flex; flex-flow: row wrap; gap: .25em 1em; }
                .pf-checks label { display: inline-flex; align-items: center; gap: .4em; margin: 0; white-space: nowrap; }
                .pf-checks input { margin: 0; }
                /* the site makes .control a max-content flex row for its one-line category list; ours wrap, and the duty groups stack on a phone */
                .filter-controls .control { width: auto; flex-wrap: wrap; gap: .5em 2em; }
                @media (max-width: 50em) { .filter-controls .control { flex-direction: column; } }
                .pf-cat-buttons { margin: .5em 0 0 1em; display: flex; gap: .5em; }
                .pf-cat-buttons a { cursor: pointer; }
                #container > .settings > .controls { flex-wrap: wrap; row-gap: .5em; }
                #pf-auto { justify-content: flex-start; gap: 1em; margin-bottom: .5em; }
                #pf-auto > label { margin: 0; }
                /* footer sits at the bottom of the screen when the list is short, and wraps only at its comma
                   (common.css already makes .js body a flex column with a 1em top margin, which becomes padding so 100vh fits) */
                .js body { min-height: 100vh; box-sizing: border-box; margin-top: 0; padding-top: 1em; }
                /* the inlined icon sprite must not take space as a flex item (display: none would break <use>) */
                body > svg { position: absolute; width: 0; height: 0; overflow: hidden; }
                footer { margin-top: auto; color: var(--meta-text); text-align: center; padding: 1em 0 2em; }
                footer span { display: inline-block; white-space: nowrap; }
                #container > .settings > .controls > select { flex: 0 1 14em; }
                #container > .settings > .controls > label { display: inline-flex; align-items: center; gap: .4em; margin: 0 0 0 1em; white-space: nowrap; }
                #container > .settings > .controls > label > input { margin: 0; }
                #container > .settings > .controls > label > select { width: auto; margin: 0; padding: .2em 2em .2em .6em; }
                nav label { display: inline-flex; align-items: center; gap: .4em; margin: 0; white-space: nowrap; }
                nav label > input { margin: 0; }
            ` }),
        );

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

        const interval = el('select', { onchange: () => { state.interval = parseInt(interval.value, 10); saveState(); scheduleRefresh(); } });
        for (const m of INTERVALS) interval.append(el('option', { value: String(m * 60), text: `${m} min` }));
        if (!INTERVALS.includes(state.interval / 60)) state.interval = 300;
        interval.value = String(state.interval);

        const autoRow = el('div', { id: 'pf-auto', class: 'controls' },
            el('label', {}, document.createTextNode('every'), interval),
            ...(platform.autoControls ? platform.autoControls(ctx) : []),
        );
        const autoRefresh = el('input', {
            type: 'checkbox', onchange: () => {
                state.autoRefresh = autoRefresh.checked;
                autoRow.hidden = !state.autoRefresh;
                saveState(); scheduleRefresh();
            },
        });
        autoRefresh.checked = state.autoRefresh;
        autoRow.hidden = !state.autoRefresh;

        const categories = el('div', { id: 'pf-categories', class: 'pf-checks' });
        for (const [key, label] of CATEGORIES) {
            categories.append(checkbox(key, label, state.categories.includes(key), () => {
                state.categories = [...categories.querySelectorAll('input:checked')].map(i => i.value);
                saveState(); render();
            }));
        }
        const setAll = on => {
            categories.querySelectorAll('input').forEach(i => { i.checked = on; });
            state.categories = on ? CATEGORIES.map(([k]) => k) : [];
            saveState(); render();
        };
        // Back to the defaults: every category, no duty restriction
        const clearFilters = () => { state.duties = []; setAll(true); };

        const brand = platform.homeHref
            ? el('a', { href: platform.homeHref, class: 'contrast', text: 'xivpf' })
            : document.createTextNode('xivpf');

        const body = document.createElement('body');
        if (platform.iconSprite) body.insertAdjacentHTML('afterbegin', platform.iconSprite);
        body.append(
            el('nav', { class: 'container' },
                el('ul', {}, el('li', {}, el('strong', { class: 'contrast' }, brand))),
                el('ul', {},
                    ...(platform.navItems ? platform.navItems(ctx) : []),
                    el('li', {}, el('a', { href: 'javascript:void(0)', text: 'clear filters', onclick: clearFilters })),
                    el('li', {}, el('a', { href: 'javascript:void(0)', text: 'refresh', onclick: () => refresh() })),
                    el('li', {}, el('label', {}, autoRefresh, document.createTextNode('auto'))),
                ),
            ),
            el('div', { class: 'container' },
                el('div', { id: 'container' },
                    el('div', { class: 'requires-js settings' },
                        autoRow,
                        el('div', { class: 'controls' },
                            search,
                            areaSelect,
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
                            // Filled by populateDuties() from the current listings
                            el('details', { class: 'filter-controls' },
                                el('summary', { id: 'pf-duties-summary', text: 'duties' }),
                                el('div', {},
                                    el('div', { id: 'pf-duties', class: 'control' }),
                                    el('div', { class: 'pf-cat-buttons' },
                                        el('a', { text: 'clear', onclick: () => { state.duties = []; saveState(); render(); } }),
                                    ),
                                ),
                            ),
                        ),
                    ),
                    el('div', { id: 'listings', class: 'list' }),
                ),
            ),
            // same links as the site's "support" menu: this page only exists thanks to their api
            el('footer', { class: 'container' },
                el('small', {},
                    el('span', { text: 'data from xivpf.com, ' }),
                    el('span', {},
                        document.createTextNode('support its '),
                        el('a', { href: 'https://ko-fi.com/zeroeightsix', target: '_blank', rel: 'noopener', text: 'current maintainer' }),
                        document.createTextNode(' or '),
                        el('a', { href: 'https://www.patreon.com/join/lojewalo', target: '_blank', rel: 'noopener', text: 'original creator' }),
                    ),
                ),
            ),
        );

        // not innerHTML = '' then append: an empty innerHTML on <html> makes the parser
        // add an implicit empty head and body, and the page ends up with two bodies
        document.documentElement.replaceChildren(head, body);
    }

    function checkbox(value, label, checked, onchange) {
        const box = el('input', { type: 'checkbox', value, onchange });
        box.checked = checked;
        return el('label', {}, box, document.createTextNode(label));
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
        use.setAttribute('href', `${platform.iconSprite ? '' : `${platform.assets}/assets/icons.svg`}#${code}`);
        svg.append(use);
        return svg;
    }

    function metaItem(cls, text, title, icon, href) {
        const label = href
            ? el('a', { class: 'text', href, target: '_blank', rel: 'noopener', text })
            : el('span', { class: 'text', text });
        return el('div', { class: `item ${cls}` },
            label,
            icon && el('span', { title }, (() => { const s = slotIcon(icon); s.setAttribute('class', 'icon'); return s; })()),
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
            el('div', { class: 'right meta' },
                metaItem('creator', `${l.recruiter} @ ${l.home_world.name}`, 'Creator', 'user',
                    `https://tomestone.gg/character-name/${encodeURIComponent(l.home_world.name)}/${encodeURIComponent(l.recruiter)}`),
                metaItem('world', createdWorldLabel(l), 'Created on', 'sphere'),
                // the sprite has no item level icon, and time_left is dropped: it was
                // rarely useful next to "updated"
                l.min_item_level > 0 ? metaItem('ilvl', `Min IL ${l.min_item_level}`, 'Minimum item level') : null,
                metaItem('updated', updatedAgo(container), 'Updated', 'clock'),
            ),
        );
    }

    function matchesAreaAndCategory(l) {
        const dcs = allowedDataCentres();
        if (dcs && !dcs.has(dataCentre(l))) return false;
        return state.categories.includes(l.category);
    }

    // Must stay in step with Listings.Filter.matches() on the android side.
    function matches(container) {
        const l = container.listing;
        if (!matchesAreaAndCategory(l)) return false;
        if (state.duties.length && !state.duties.includes(dutyName(l))) return false;
        if (state.search) {
            const needle = state.search.toLowerCase();
            const haystack = [dutyName(l), l.description.en, l.recruiter, l.created_world.name, l.home_world.name]
                .join(' ').toLowerCase();
            if (!haystack.includes(needle)) return false;
        }
        return true;
    }

    let dutyPanelKey = null;

    // Duties panel: duties with listings in the selected area/categories,
    // grouped by category. Checked duties nobody is currently recruiting for
    // stay in a "not listed" group so they can still be unchecked.
    function populateDuties() {
        const panel = document.getElementById('pf-duties');
        if (!panel) return;
        const byCategory = new Map(CATEGORIES.map(([key]) => [key, new Set()]));
        for (const c of containers) {
            const l = c.listing;
            if (matchesAreaAndCategory(l)) byCategory.get(l.category)?.add(dutyName(l));
        }
        const groups = [...byCategory].filter(([, set]) => set.size)
            .map(([key, set]) => [CATEGORY_LABEL[key], [...set].sort()]);
        const listed = new Set(groups.flatMap(([, duties]) => duties));
        const unlisted = state.duties.filter(d => !listed.has(d));
        if (unlisted.length) groups.push(['Not listed', unlisted.sort()]);

        document.getElementById('pf-duties-summary').textContent =
            state.duties.length ? `duties (${state.duties.length})` : 'duties';

        // Skip the rebuild when nothing changed, so focus isn't lost on every keystroke/refresh
        const key = JSON.stringify([state.duties, groups]);
        if (key === dutyPanelKey) return;
        dutyPanelKey = key;

        const onchange = () => {
            state.duties = [...panel.querySelectorAll('input:checked')].map(i => i.value);
            saveState(); render();
        };
        panel.replaceChildren(...groups.map(([label, duties]) => el('div', {},
            el('strong', { text: label }),
            el('div', { class: 'pf-checks' }, ...duties.map(d => checkbox(d, d, state.duties.includes(d), onchange))),
        )));
        if (!groups.length) panel.append(el('em', { text: 'No duties listed.' }));
    }

    function setStatus(text) {
        const status = document.getElementById('pf-status');
        if (status) status.textContent = text;
    }

    function render() {
        const listings = document.getElementById('listings');
        if (!listings) return;
        populateDuties();
        const shown = containers.filter(matches);
        listings.replaceChildren(...shown.map(renderRow));
        if (shown.length === 0) {
            listings.append(el('em', { class: 'no-listings', text: containers.length ? 'No listings match the current filter.' : 'No listings.' }));
        }
        setStatus(`${shown.length} / ${containers.length} listings, updated ${new Date(fetchedAt).toLocaleTimeString()}`);
        if (platform.onRender) platform.onRender(ctx);
    }

    // ---------------------------------------------------------------
    // Data
    // ---------------------------------------------------------------

    async function refresh() {
        setStatus('loading...');
        try {
            const data = await platform.fetchListings();
            fetchedAt = Date.now();
            containers = data
                .filter(c => c && c.listing)
                .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
            render();
        } catch (e) {
            console.error('[xivpf pf] refresh failed', e);
            setStatus(`refresh failed: ${e.message}`);
        }
        scheduleRefresh();
    }

    function scheduleRefresh() {
        clearTimeout(refreshTimer);
        if (state.autoRefresh) {
            refreshTimer = setTimeout(refresh, state.interval * 1000);
        }
    }

    // ---------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------

    function boot() {
        loadState();
        buildPage();
        refresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    return ctx;
};
