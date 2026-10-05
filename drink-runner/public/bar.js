// Shared helpers for the drink runner pages.
var Bar = (function () {
    function api(path, opts) {
        opts = opts || {};
        var headers = { 'content-type': 'application/json' };
        if (opts.staffKey) headers['x-staff-key'] = opts.staffKey;
        if (opts.guestToken) headers['x-guest-token'] = opts.guestToken;
        return fetch('/api/bar/' + path, {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            cache: 'no-store'
        }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
                if (!res.ok) {
                    var e = new Error(data.error || 'Could not reach the bar. Check your signal and try again.');
                    e.status = res.status;
                    throw e;
                }
                return data;
            });
        }, function () {
            throw new Error('Could not reach the bar. Check your signal and try again.');
        });
    }

    function load(key, fallback) {
        try {
            var v = localStorage.getItem(key);
            return v ? JSON.parse(v) : fallback;
        } catch (e) { return fallback; }
    }

    function save(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }

    function getPosition() {
        return new Promise(function (resolve, reject) {
            if (!navigator.geolocation) return reject(new Error('This browser cannot share location.'));
            navigator.geolocation.getCurrentPosition(resolve, function (err) {
                var msg = err.code === 1
                    ? 'Location is blocked. You can still order; just describe where you are.'
                    : 'Could not get your location. Describe where you are instead.';
                reject(new Error(msg));
            }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
        });
    }

    // Distance in meters between two lat/lng points.
    function distance(a, b) {
        var R = 6371000, toRad = Math.PI / 180;
        var dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
        var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.asin(Math.sqrt(s));
    }

    function bearing(a, b) {
        var toRad = Math.PI / 180;
        var y = Math.sin((b.lng - a.lng) * toRad) * Math.cos(b.lat * toRad);
        var x = Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
            Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos((b.lng - a.lng) * toRad);
        return (Math.atan2(y, x) / toRad + 360) % 360;
    }

    function compass(deg) {
        return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(deg / 45) % 8];
    }

    function ago(ms) {
        var s = Math.max(0, Math.round(ms / 1000));
        if (s < 60) return s + ' sec ago';
        var m = Math.round(s / 60);
        if (m < 60) return m + ' min ago';
        return Math.round(m / 60) + ' hr ago';
    }

    function el(tag, attrs, text) {
        var n = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === 'class') n.className = attrs[k];
            else n.setAttribute(k, attrs[k]);
        });
        if (text != null) n.textContent = text;
        return n;
    }

    function mount(id) {
        var app = document.getElementById('app');
        app.replaceChildren(document.getElementById(id).content.cloneNode(true));
        return app;
    }

    function showErr(node, msg) {
        node.textContent = msg || '';
        node.hidden = !msg;
    }

    return { api: api, load: load, save: save, getPosition: getPosition, distance: distance,
        bearing: bearing, compass: compass, ago: ago, el: el, mount: mount, showErr: showErr };
})();
