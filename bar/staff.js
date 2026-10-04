// Staff side: live queue for the bartender, location + directions for runners.
(function () {
    var hash = new URLSearchParams(location.hash.slice(1));
    var eventId = hash.get('e');
    var staffKey = hash.get('k');
    var app = document.getElementById('app');

    if (!eventId || !staffKey) {
        app.replaceChildren(
            Bar.el('h1', null, 'Staff link incomplete'),
            Bar.el('p', { class: 'muted' }, 'Open the full staff link you were sent, or start a new bar.'),
            Bar.el('a', { class: 'btn primary', href: './' }, 'Start a bar')
        );
        return;
    }

    var state = { event: null, orders: [], tab: Bar.load('bar-tab', 'bar'), me: null, sig: '', seen: null };
    var guestLink = location.origin + location.pathname.replace(/staff\.html$/, '') + '?e=' + eventId;
    var staffLink = location.href;
    var audio = null;

    function api(path, opts) {
        opts = opts || {};
        opts.staffKey = staffKey;
        return Bar.api('events/' + eventId + '/staff' + (path || ''), opts);
    }

    Bar.mount('tpl-staff');
    var listEl = document.getElementById('q-list');
    var errEl = document.getElementById('q-err');
    document.getElementById('q-guest-link').value = guestLink;
    document.getElementById('q-staff-link').value = staffLink;
    var runnerName = document.getElementById('q-runner-name');
    runnerName.value = Bar.load('bar-runner', '');
    runnerName.addEventListener('change', function () { Bar.save('bar-runner', runnerName.value.trim()); });

    if (window.QRCode) {
        new QRCode(document.getElementById('q-qr'), { text: guestLink, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    } else {
        document.getElementById('q-qr').hidden = true;
    }

    document.getElementById('q-share-toggle').addEventListener('click', function () {
        var p = document.getElementById('q-share');
        p.hidden = !p.hidden;
    });

    document.querySelectorAll('[data-copy]').forEach(function (b) {
        b.addEventListener('click', function () {
            var input = document.getElementById(b.dataset.copy);
            var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1500); };
            if (navigator.clipboard) {
                navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
            } else {
                input.select();
            }
        });
    });

    document.getElementById('q-save-menu').addEventListener('click', function (e) {
        var btn = e.currentTarget;
        var menu = document.getElementById('q-menu').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        btn.disabled = true;
        api('', { method: 'PATCH', body: { menu: menu } }).then(function (d) {
            state.event = d.event;
            btn.textContent = 'Saved';
            setTimeout(function () { btn.textContent = 'Save menu'; }, 1500);
        }, function (err) { Bar.showErr(errEl, err.message); }).then(function () { btn.disabled = false; });
    });

    document.getElementById('q-toggle-open').addEventListener('click', function () {
        api('', { method: 'PATCH', body: { open: !state.event.open } }).then(function (d) {
            state.event = d.event;
            renderHeader();
        }, function (err) { Bar.showErr(errEl, err.message); });
    });

    document.querySelectorAll('[data-tab]').forEach(function (b) {
        b.addEventListener('click', function () {
            state.tab = b.dataset.tab;
            Bar.save('bar-tab', state.tab);
            renderList(true);
        });
    });

    document.getElementById('q-me').addEventListener('click', function (e) {
        var btn = e.currentTarget;
        var status = document.getElementById('q-me-status');
        if (!navigator.geolocation) { status.textContent = 'This browser cannot share location.'; return; }
        btn.disabled = true;
        status.textContent = 'Finding you…';
        navigator.geolocation.watchPosition(function (pos) {
            var next = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
            var moved = !state.me || Bar.distance(state.me, next) > 3;
            state.me = next;
            status.textContent = 'On. Your GPS accuracy: about ' + Math.round(pos.coords.accuracy) + ' m.';
            btn.textContent = 'Location on';
            if (moved) renderList(true);
        }, function (err) {
            btn.disabled = false;
            status.textContent = err.code === 1 ? 'Location is blocked for this site in your browser settings.' : 'Could not get your location.';
        }, { enableHighAccuracy: true, maximumAge: 5000 });
    });

    // Unlock sound on first tap (browsers block audio until the user interacts).
    document.addEventListener('click', function () {
        if (audio) return;
        try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }, { once: true });

    function chime() {
        if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
        if (!audio) return;
        [880, 1320].forEach(function (f, i) {
            var o = audio.createOscillator(), g = audio.createGain();
            o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.18);
            g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + i * 0.18 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.18 + 0.3);
            o.connect(g).connect(audio.destination);
            o.start(audio.currentTime + i * 0.18);
            o.stop(audio.currentTime + i * 0.18 + 0.32);
        });
    }

    function renderHeader() {
        var ev = state.event;
        document.getElementById('q-name').textContent = ev.name;
        document.title = ev.name + ' · Queue';
        var pill = document.getElementById('q-open-pill');
        pill.textContent = ev.open ? 'Taking orders' : 'Paused';
        pill.className = 'pill ' + (ev.open ? 'ready' : 'cancelled');
        document.getElementById('q-toggle-open').textContent = ev.open ? 'Pause new orders' : 'Resume orders';
        var menuEl = document.getElementById('q-menu');
        if (document.activeElement !== menuEl) menuEl.value = ev.menu.join('\n');
    }

    function setStatus(order, status, btn) {
        btn.disabled = true;
        var body = { status: status };
        if (status === 'ready' || status === 'delivered') body.runner = runnerName.value.trim();
        api('/orders/' + order.id, { method: 'PATCH', body: body }).then(function (d) {
            state.orders = state.orders.map(function (o) { return o.id === d.order.id ? d.order : o; });
            renderList(true);
        }, function (err) {
            btn.disabled = false;
            Bar.showErr(errEl, err.message);
        });
    }

    function button(label, cls, onClick) {
        var b = Bar.el('button', { type: 'button', class: cls || '' }, label);
        b.addEventListener('click', function () { onClick(b); });
        return b;
    }

    function ticket(o, fresh) {
        var card = Bar.el('article', { class: 'ticket' + (fresh ? ' fresh' : '') });
        var top = Bar.el('div', { class: 'top' });
        top.append(Bar.el('span', { class: 'num' }, '#' + o.number));
        var labels = { new: 'New', making: 'Making', ready: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
        top.append(Bar.el('span', { class: 'pill ' + o.status }, labels[o.status]));
        card.append(top);
        card.append(Bar.el('div', { class: 'drink' }, o.drink));

        var meta = Bar.el('div', { class: 'meta' });
        meta.append(Bar.el('div', null, 'For ' + o.name + ' · ordered ' + Bar.ago(Date.now() - o.createdAt)));
        if (o.notes) meta.append(Bar.el('div', null, 'Notes: ' + o.notes));
        if (o.where) meta.append(Bar.el('div', null, 'Spot them: ' + o.where));
        if (o.runner && (o.status === 'ready' || o.status === 'delivered')) meta.append(Bar.el('div', { class: 'muted' }, 'Runner: ' + o.runner));
        card.append(meta);

        if (o.status === 'ready' || o.status === 'making' || o.status === 'new') {
            var loc = Bar.el('div', { class: 'meta small' });
            if (o.loc) {
                var line = 'GPS ' + Bar.ago(Date.now() - o.loc.at);
                if (o.loc.acc != null) line += ', accurate to about ' + o.loc.acc + ' m';
                loc.append(Bar.el('div', { class: Date.now() - o.loc.at > 5 * 60000 ? 'warnc' : 'muted' }, line));
                if (state.me) {
                    var d = Bar.distance(state.me, o.loc);
                    var dir = d < 5 ? 'right around you' : Math.round(d) + ' m ' + Bar.compass(Bar.bearing(state.me, o.loc));
                    loc.append(Bar.el('div', { class: 'okc', style: 'font-weight:600;font-size:1rem' }, dir));
                }
            } else {
                loc.append(Bar.el('div', { class: 'warnc' }, 'No GPS. Use the description above.'));
            }
            card.append(loc);
        }

        var actions = Bar.el('div', { class: 'actions' });
        if (o.status === 'new') {
            actions.append(button('Start making', 'primary', function (b) { setStatus(o, 'making', b); }));
            actions.append(button('Cancel', '', function (b) {
                if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again'; return; }
                setStatus(o, 'cancelled', b);
            }));
        } else if (o.status === 'making') {
            actions.append(button('Ready for runner', 'primary', function (b) { setStatus(o, 'ready', b); }));
            actions.append(button('Back', '', function (b) { setStatus(o, 'new', b); }));
        } else if (o.status === 'ready') {
            if (o.loc) {
                actions.append(Bar.el('a', {
                    class: 'btn',
                    href: 'https://www.google.com/maps/search/?api=1&query=' + o.loc.lat + ',' + o.loc.lng,
                    target: '_blank', rel: 'noopener'
                }, 'Open in Maps'));
            }
            actions.append(button('Delivered', 'primary', function (b) { setStatus(o, 'delivered', b); }));
        } else {
            actions.append(button('Undo', '', function (b) { setStatus(o, o.status === 'delivered' ? 'ready' : 'new', b); }));
        }
        card.append(actions);
        return card;
    }

    function renderList(force) {
        var groups = {
            bar: state.orders.filter(function (o) { return o.status === 'new' || o.status === 'making'; }),
            run: state.orders.filter(function (o) { return o.status === 'ready'; }),
            done: state.orders.filter(function (o) { return o.status === 'delivered' || o.status === 'cancelled'; }).reverse()
        };
        document.getElementById('c-bar').textContent = groups.bar.length ? '(' + groups.bar.length + ')' : '';
        document.getElementById('c-run').textContent = groups.run.length ? '(' + groups.run.length + ')' : '';
        document.getElementById('c-done').textContent = groups.done.length ? '(' + groups.done.length + ')' : '';
        document.querySelectorAll('[data-tab]').forEach(function (b) {
            b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
        });

        // Skip rebuilding when nothing changed, so a tap in progress isn't lost.
        var sig = state.tab + '|' + JSON.stringify(groups[state.tab]);
        if (!force && sig === state.sig) return;
        state.sig = sig;

        var items = groups[state.tab];
        if (!items.length) {
            var msg = {
                bar: 'No drinks to make. New orders appear here automatically.',
                run: 'Nothing waiting for a runner.',
                done: 'Delivered and cancelled orders show up here.'
            }[state.tab];
            listEl.replaceChildren(Bar.el('div', { class: 'empty' }, msg));
            return;
        }
        var fresh = state.freshIds || {};
        listEl.replaceChildren.apply(listEl, items.map(function (o) { return ticket(o, fresh[o.id]); }));
        state.freshIds = {};
    }

    function poll() {
        api('').then(function (d) {
            Bar.showErr(errEl, '');
            state.event = d.event;
            renderHeader();
            var ids = {};
            var newOnes = {};
            d.orders.forEach(function (o) {
                ids[o.id] = true;
                if (state.seen && !state.seen[o.id]) newOnes[o.id] = true;
            });
            if (state.seen && Object.keys(newOnes).length) chime();
            state.freshIds = newOnes;
            state.seen = ids;
            state.orders = d.orders;
            renderList(false);
            document.getElementById('q-updated').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) + '. Refreshes every few seconds.';
        }, function (err) {
            Bar.showErr(errEl, err.message);
            if (err.status === 403 || err.status === 404) clearInterval(timer);
        });
    }

    // Keep the screen awake at the bar, where supported.
    function wake() {
        if (navigator.wakeLock && !document.hidden) navigator.wakeLock.request('screen').catch(function () {});
    }
    wake();
    document.addEventListener('visibilitychange', wake);

    poll();
    var timer = setInterval(function () { if (!document.hidden) poll(); }, 3000);
    // Keep "x min ago" labels current even when no data changes.
    setInterval(function () { renderList(true); }, 30000);
})();
