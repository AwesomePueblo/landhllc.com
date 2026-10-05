// Drink runner API for /bar/. Guests place orders with their GPS location;
// staff (holding the bar's secret key) see the queue and update status.
//
// Storage (Netlify Blobs, store "bar"):
//   events/<eventId>            -> { id, name, menu, open, keyHash, createdAt }
//   orders/<eventId>/<orderId>  -> order record (see createOrder)

import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const STATUSES = ['new', 'making', 'ready', 'delivered', 'cancelled'];
const MAX_ORDERS_PER_EVENT = 3000;
const MAX_MENU_ITEMS = 60;

const json = (status, body) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });

const fail = (status, error) => json(status, { error });

const newId = (bytes) => randomBytes(bytes).toString('base64url');
const hash = (s) => createHash('sha256').update(String(s)).digest();

function str(v, max) {
    if (typeof v !== 'string') return '';
    return v.trim().slice(0, max);
}

function num(v, min, max) {
    const n = typeof v === 'number' ? v : Number.NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function cleanMenu(menu) {
    if (!Array.isArray(menu)) return [];
    return menu.map((m) => str(m, 60)).filter(Boolean).slice(0, MAX_MENU_ITEMS);
}

// Returns { lat, lng, acc, at } or null when the payload has no usable fix.
function cleanLocation(body) {
    const lat = num(body.lat, -90, 90);
    const lng = num(body.lng, -180, 180);
    if (lat === null || lng === null) return null;
    const acc = num(body.acc, 0, 100000);
    return { lat, lng, acc: acc === null ? null : Math.round(acc), at: Date.now() };
}

function publicEvent(ev) {
    return { id: ev.id, name: ev.name, menu: ev.menu, open: ev.open };
}

function guestView(o) {
    return {
        id: o.id,
        number: o.number,
        name: o.name,
        drink: o.drink,
        notes: o.notes,
        where: o.where,
        status: o.status,
        hasLocation: !!o.loc,
        locAt: o.loc ? o.loc.at : null,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
    };
}

function staffView(o) {
    const { guestToken, ...rest } = o;
    return rest;
}

export function createHandler(store) {
    async function loadEvent(id) {
        if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return null;
        return store.get(`events/${id}`, { type: 'json' });
    }

    function isStaff(ev, req) {
        const key = req.headers.get('x-staff-key') || '';
        if (!key) return false;
        const a = hash(key);
        const b = Buffer.from(ev.keyHash, 'hex');
        return a.length === b.length && timingSafeEqual(a, b);
    }

    async function loadOrders(eventId) {
        const { blobs } = await store.list({ prefix: `orders/${eventId}/` });
        const orders = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
        return orders.filter(Boolean);
    }

    async function loadOrder(eventId, orderId) {
        if (!/^[A-Za-z0-9_-]{4,40}$/.test(orderId)) return null;
        return store.get(`orders/${eventId}/${orderId}`, { type: 'json' });
    }

    const saveOrder = (o) => store.setJSON(`orders/${o.eventId}/${o.id}`, o);

    async function readBody(req) {
        try {
            const b = await req.json();
            return b && typeof b === 'object' ? b : {};
        } catch {
            return {};
        }
    }

    return async function handle(req) {
        const url = new URL(req.url);
        const parts = url.pathname.replace(/^\/api\/bar\/?/, '').split('/').filter(Boolean);
        const method = req.method;

        // POST /api/bar/events  -> start a new bar
        if (parts.length === 1 && parts[0] === 'events' && method === 'POST') {
            const body = await readBody(req);
            const name = str(body.name, 80) || 'The Bar';
            const key = newId(18);
            const ev = {
                id: newId(6),
                name,
                menu: cleanMenu(body.menu),
                open: true,
                keyHash: hash(key).toString('hex'),
                createdAt: Date.now(),
            };
            await store.setJSON(`events/${ev.id}`, ev);
            return json(201, { event: publicEvent(ev), staffKey: key });
        }

        if (parts[0] !== 'events' || !parts[1]) return fail(404, 'Not found');
        const ev = await loadEvent(parts[1]);
        if (!ev) return fail(404, 'This bar link is not valid. Ask the bartender for the current link.');
        const rest = parts.slice(2);

        // GET /api/bar/events/:id  -> name and menu for guests
        if (rest.length === 0 && method === 'GET') {
            return json(200, { event: publicEvent(ev) });
        }

        // POST /api/bar/events/:id/orders  -> guest places an order
        if (rest.length === 1 && rest[0] === 'orders' && method === 'POST') {
            if (!ev.open) return fail(409, 'The bar is not taking orders right now.');
            const body = await readBody(req);
            const name = str(body.name, 40);
            const drink = str(body.drink, 80);
            if (!name) return fail(400, 'Please enter your name.');
            if (!drink) return fail(400, 'Please choose a drink.');
            const existing = await store.list({ prefix: `orders/${ev.id}/` });
            if (existing.blobs.length >= MAX_ORDERS_PER_EVENT) {
                return fail(429, 'This bar has reached its order limit.');
            }
            const now = Date.now();
            // Ticket numbers are for humans only; two orders landing in the
            // same instant can share one, which is harmless.
            const number = existing.blobs.length + 1;
            const order = {
                id: newId(9),
                eventId: ev.id,
                number,
                guestToken: newId(18),
                name,
                drink,
                notes: str(body.notes, 200),
                where: str(body.where, 120),
                loc: cleanLocation(body),
                status: 'new',
                createdAt: now,
                updatedAt: now,
            };
            await saveOrder(order);
            return json(201, { order: guestView(order), guestToken: order.guestToken });
        }

        // /api/bar/events/:id/orders/:orderId  -> guest checks or updates own order
        if (rest.length === 2 && rest[0] === 'orders') {
            const order = await loadOrder(ev.id, rest[1]);
            const token = req.headers.get('x-guest-token') || '';
            if (!order || !token || token !== order.guestToken) return fail(404, 'Order not found.');

            if (method === 'GET') return json(200, { order: guestView(order) });

            if (method === 'PATCH') {
                const body = await readBody(req);
                if (body.cancel === true) {
                    if (order.status !== 'new') {
                        return fail(409, 'The bartender already started this one, so it can no longer be cancelled here.');
                    }
                    order.status = 'cancelled';
                }
                const loc = cleanLocation(body);
                if (loc) order.loc = loc;
                if (typeof body.where === 'string') order.where = str(body.where, 120);
                order.updatedAt = Date.now();
                await saveOrder(order);
                return json(200, { order: guestView(order) });
            }
            return fail(405, 'Method not allowed');
        }

        // Everything below needs the staff key.
        if (rest[0] !== 'staff') return fail(404, 'Not found');
        if (!isStaff(ev, req)) return fail(403, 'This staff link is not valid.');

        // GET /api/bar/events/:id/staff  -> full queue
        if (rest.length === 1 && method === 'GET') {
            const orders = await loadOrders(ev.id);
            orders.sort((a, b) => a.createdAt - b.createdAt);
            return json(200, { event: publicEvent(ev), orders: orders.map(staffView), serverTime: Date.now() });
        }

        // PATCH /api/bar/events/:id/staff  -> update menu / open state / name
        if (rest.length === 1 && method === 'PATCH') {
            const body = await readBody(req);
            if (Array.isArray(body.menu)) ev.menu = cleanMenu(body.menu);
            if (typeof body.open === 'boolean') ev.open = body.open;
            if (typeof body.name === 'string' && str(body.name, 80)) ev.name = str(body.name, 80);
            await store.setJSON(`events/${ev.id}`, ev);
            return json(200, { event: publicEvent(ev) });
        }

        // PATCH /api/bar/events/:id/staff/orders/:orderId  -> set status
        if (rest.length === 3 && rest[1] === 'orders' && method === 'PATCH') {
            const order = await loadOrder(ev.id, rest[2]);
            if (!order) return fail(404, 'Order not found.');
            const body = await readBody(req);
            if (!STATUSES.includes(body.status)) return fail(400, 'Unknown status.');
            order.status = body.status;
            if (typeof body.runner === 'string') order.runner = str(body.runner, 40);
            order.updatedAt = Date.now();
            await saveOrder(order);
            return json(200, { order: staffView(order) });
        }

        return fail(404, 'Not found');
    };
}

export default async (req) => {
    const store = getStore({ name: 'bar', consistency: 'strong' });
    try {
        return await createHandler(store)(req);
    } catch (err) {
        console.error(err);
        return fail(500, 'Something went wrong on the server. Try again in a moment.');
    }
};

export const config = { path: ['/api/bar', '/api/bar/*'] };
