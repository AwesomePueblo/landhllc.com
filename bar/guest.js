// Guest side: start a bar (no ?e=), place an order, follow its status.
(function () {
    var params = new URLSearchParams(location.search);
    var eventId = params.get('e');
    var orderKey = 'bar-order-' + eventId;
    var pollTimer = null;
    var watchId = null;
    var lastSent = null; // { lat, lng, t } last location pushed to the server

    if (!eventId) return setup();

    Bar.api('events/' + encodeURIComponent(eventId)).then(function (data) {
        var saved = Bar.load(orderKey, null);
        if (saved && saved.orderId) showStatus(data.event, saved);
        else showOrderForm(data.event);
    }, function (err) {
        var app = document.getElementById('app');
        app.replaceChildren(Bar.el('h1', null, 'Bar not found'), Bar.el('p', { class: 'muted' }, err.message));
    });

    // ---------- Setup (organizer) ----------
    function setup() {
        document.title = 'Start a Bar';
        Bar.mount('tpl-setup');
        var recent = Bar.load('bar-staff', []);
        if (recent.length) {
            document.getElementById('s-recent').hidden = false;
            var list = document.getElementById('s-recent-list');
            recent.slice(-5).reverse().forEach(function (r) {
                list.appendChild(Bar.el('a', { class: 'btn', href: 'staff.html#e=' + r.id + '&k=' + r.key }, 'Open ' + r.name));
            });
        }
        document.getElementById('setup-form').addEventListener('submit', function (e) {
            e.preventDefault();
            var btn = document.getElementById('s-go');
            var errEl = document.getElementById('s-err');
            btn.disabled = true;
            Bar.showErr(errEl, '');
            var menu = document.getElementById('s-menu').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
            Bar.api('events', { method: 'POST', body: { name: document.getElementById('s-name').value, menu: menu } })
                .then(function (data) {
                    var list = Bar.load('bar-staff', []);
                    list.push({ id: data.event.id, key: data.staffKey, name: data.event.name });
                    Bar.save('bar-staff', list);
                    location.href = 'staff.html#e=' + data.event.id + '&k=' + data.staffKey;
                }, function (err) {
                    btn.disabled = false;
                    Bar.showErr(errEl, err.message);
                });
        });
    }

    // ---------- Order form ----------
    function showOrderForm(event) {
        stopTracking();
        Bar.mount('tpl-order');
        document.getElementById('o-bar').textContent = event.name;
        var nameEl = document.getElementById('o-name');
        var drinkEl = document.getElementById('o-drink');
        var whereEl = document.getElementById('o-where');
        var profile = Bar.load('bar-profile', {});
        nameEl.value = profile.name || '';
        whereEl.value = profile.where || '';

        var menuEl = document.getElementById('o-menu');
        var picked = '';
        event.menu.forEach(function (item) {
            var b = Bar.el('button', { type: 'button', 'aria-pressed': 'false' }, item);
            b.addEventListener('click', function () {
                picked = picked === item ? '' : item;
                menuEl.querySelectorAll('button').forEach(function (x) {
                    x.setAttribute('aria-pressed', String(x.textContent === picked));
                });
                if (picked) drinkEl.value = '';
            });
            menuEl.appendChild(b);
        });
        if (!event.menu.length) menuEl.hidden = true;
        drinkEl.addEventListener('input', function () {
            if (drinkEl.value) {
                picked = '';
                menuEl.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
            }
        });

        var errEl = document.getElementById('o-err');
        if (!event.open) {
            Bar.showErr(errEl, 'The bar is not taking orders right now.');
        }

        document.getElementById('order-form').addEventListener('submit', function (e) {
            e.preventDefault();
            var drink = picked || drinkEl.value.trim();
            if (!nameEl.value.trim()) return Bar.showErr(errEl, 'Please enter your name.');
            if (!drink) return Bar.showErr(errEl, 'Please choose a drink.');
            Bar.showErr(errEl, '');
            var btn = document.getElementById('o-go');
            btn.disabled = true;
            btn.textContent = 'Getting your location…';
            Bar.save('bar-profile', { name: nameEl.value.trim(), where: whereEl.value.trim() });

            var body = {
                name: nameEl.value, drink: drink,
                notes: document.getElementById('o-notes').value, where: whereEl.value
            };
            Bar.getPosition().then(function (pos) {
                body.lat = pos.coords.latitude;
                body.lng = pos.coords.longitude;
                body.acc = pos.coords.accuracy;
            }, function (locErr) {
                if (!whereEl.value.trim()) {
                    throw new Error(locErr.message + ' Fill in "How will the runner spot you?" and send again.');
                }
            }).then(function () {
                btn.textContent = 'Sending…';
                return Bar.api('events/' + eventId + '/orders', { method: 'POST', body: body });
            }).then(function (data) {
                var saved = { orderId: data.order.id, token: data.guestToken };
                Bar.save(orderKey, saved);
                if (body.lat != null) lastSent = { lat: body.lat, lng: body.lng, t: Date.now() };
                showStatus(event, saved, data.order);
            }).catch(function (err) {
                btn.disabled = false;
                btn.textContent = 'Send order';
                Bar.showErr(errEl, err.message);
            });
        });
    }

    // ---------- Status ----------
    function showStatus(event, saved, initial) {
        Bar.mount('tpl-status');
        document.title = 'Your Drink';
        document.getElementById('st-bar').textContent = event.name;
        var errEl = document.getElementById('st-err');
        var whereEl = document.getElementById('st-where');
        var current = null;
        var path = 'events/' + eventId + '/orders/' + saved.orderId;

        function render(o) {
            current = o;
            document.getElementById('st-drink').textContent = o.drink;
            var pill = document.getElementById('st-pill');
            var labels = { new: 'Received', making: 'Making', ready: 'On its way', delivered: 'Delivered', cancelled: 'Cancelled' };
            pill.textContent = labels[o.status];
            pill.className = 'pill ' + o.status;
            var order = ['new', 'making', 'ready', 'delivered'];
            var idx = order.indexOf(o.status);
            document.querySelectorAll('#st-steps span').forEach(function (s) {
                s.classList.toggle('on', order.indexOf(s.dataset.s) <= idx && idx >= 0);
            });
            var msgs = {
                new: 'Order #' + o.number + ' is in the queue.',
                making: 'The bartender is making your drink.',
                ready: 'A runner is bringing it to you now. Stay put if you can.',
                delivered: 'Enjoy!',
                cancelled: 'This order was cancelled.'
            };
            document.getElementById('st-title').textContent = o.status === 'ready' ? 'On its way' : (o.status === 'delivered' ? 'Delivered' : 'Order #' + o.number);
            document.getElementById('st-msg').textContent = msgs[o.status];
            if (document.activeElement !== whereEl) whereEl.value = o.where || '';
            var locEl = document.getElementById('st-loc');
            if (o.hasLocation) {
                locEl.textContent = 'Location shared ' + Bar.ago(Date.now() - o.locAt) + '. It updates while this page is open.';
                locEl.className = 'small okc';
            } else {
                locEl.textContent = 'No GPS location shared. The runner will use your description.';
                locEl.className = 'small warnc';
            }
            var done = o.status === 'delivered' || o.status === 'cancelled';
            document.getElementById('st-cancel').hidden = o.status !== 'new';
            document.getElementById('st-again').hidden = !done;
            if (done) stopTracking(); else startTracking();
        }

        function refresh() {
            Bar.api(path, { guestToken: saved.token }).then(function (d) {
                Bar.showErr(errEl, '');
                render(d.order);
            }, function (err) {
                if (err.status === 404) {
                    Bar.save(orderKey, null);
                    return showOrderForm(event);
                }
                Bar.showErr(errEl, err.message);
            });
        }

        function patch(body) {
            return Bar.api(path, { method: 'PATCH', guestToken: saved.token, body: body }).then(function (d) {
                Bar.showErr(errEl, '');
                render(d.order);
            }, function (err) { Bar.showErr(errEl, err.message); });
        }

        function startTracking() {
            if (watchId != null || !navigator.geolocation) return;
            watchId = navigator.geolocation.watchPosition(function (pos) {
                var p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                var moved = !lastSent || Bar.distance(lastSent, p) > 8;
                var stale = !lastSent || Date.now() - lastSent.t > 60000;
                if (!moved && !stale) return;
                lastSent = { lat: p.lat, lng: p.lng, t: Date.now() };
                patch({ lat: p.lat, lng: p.lng, acc: pos.coords.accuracy });
            }, function () {}, { enableHighAccuracy: true, maximumAge: 10000 });
        }

        document.getElementById('st-save-where').addEventListener('click', function () {
            var p = Bar.load('bar-profile', {});
            p.where = whereEl.value.trim();
            Bar.save('bar-profile', p);
            patch({ where: whereEl.value });
        });
        document.getElementById('st-reloc').addEventListener('click', function (e) {
            var btn = e.currentTarget;
            btn.disabled = true;
            Bar.getPosition().then(function (pos) {
                lastSent = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
                return patch({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
            }, function (err) { Bar.showErr(errEl, err.message); }).then(function () { btn.disabled = false; });
        });
        document.getElementById('st-cancel').addEventListener('click', function (e) {
            var btn = e.currentTarget;
            if (btn.dataset.confirm !== '1') {
                btn.dataset.confirm = '1';
                btn.textContent = 'Tap again to cancel';
                return;
            }
            patch({ cancel: true });
        });
        document.getElementById('st-again').addEventListener('click', function () {
            Bar.save(orderKey, null);
            showOrderForm(event);
        });

        if (initial) render(initial);
        refresh();
        clearInterval(pollTimer);
        pollTimer = setInterval(function () {
            if (current && (current.status === 'delivered' || current.status === 'cancelled')) return;
            if (!document.hidden) refresh();
        }, 5000);
    }

    function stopTracking() {
        if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        clearInterval(pollTimer);
    }
})();
