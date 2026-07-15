(function () {
    'use strict';

    // ---------- Config ----------
    const BLOB_RADIUS = 13;
    const ENCOUNTER_DISTANCE = 28;
    const TAP_TOLERANCE = 18; // extra hit-test radius beyond the visual blob, for touch/finger taps
    const WOBBLE_POINTS = 10;
    const WOBBLE_AMPLITUDE = BLOB_RADIUS * 0.18;
    const WOBBLE_SPEED = 1.6; // radians per second
    const TALK_COOLDOWN_MS = 15000;
    const MAX_CONCURRENT_REQUESTS = 2;
    const SESSION_REQUEST_CAP = 60;
    const SPEED = 0.35;
    const FEED_ITEM_LIMIT = 6;

    const AFFINITY_MIN = -100;
    const AFFINITY_MAX = 100;
    const FRIENDLY_AFFINITY_DELTA = 15;
    const HOSTILE_AFFINITY_DELTA = -20;
    const NEUTRAL_AFFINITY_DELTA = 0; // a neutral encounter shouldn't build goodwill on its own
    const AFFINITY_DECAY_PER_FRAME = 0.01; // relationships drift back toward 0 without upkeep (~2.8 min from max)
    const COLOR_BLEND_FACTOR = 0.12;
    const WINNER_AFFINITY_SCALE = 0.6; // the winner is less moved by the encounter, staying closer to who they were
    const LOSER_AFFINITY_SCALE = 1.6; // the loser swings harder toward (or away from) the winner
    const WINNER_COLOR_SCALE = 0.5; // the winner's color barely drifts
    const LOSER_COLOR_SCALE = 1.8; // the loser's color drifts hard toward the winner's
    const LIKE_THRESHOLD = 20;
    const DISLIKE_THRESHOLD = -20;
    const SOCIAL_ATTRACT = 0.03;
    const SOCIAL_REPEL = 0.03;
    const SOCIAL_REPEL_RANGE = 160;
    const BASE_ATTRACT = 0.018; // baseline pull toward the nearest other blob, active before any relationship exists

    const ENERGY_MAX = 100;
    const ENERGY_DECAY_PER_FRAME = 0.02; // full drain in ~80s with no encounters
    const ENERGY_RESTORE = { friendly: 35, neutral: 20, hostile: 10 };
    const ENERGY_URGENCY_MULTIPLIER = 2.5; // how much harder a depleted blob seeks company

    const STORAGE_KEY = 'ai-blob-sim-state-v1';
    const AUTOSAVE_INTERVAL_MS = 5000;

    const SCENE_COUNT = 4;
    const SCENE_PROXIMITY_RADIUS = 90;
    const SCENE_TYPES = [
        { icon: '🔥', name: 'Bonfire', description: 'a crackling bonfire radiating warmth and light' },
        { icon: '🌳', name: 'Ancient Tree', description: 'an enormous ancient tree with roots older than memory' },
        { icon: '⛲', name: 'Old Well', description: 'a crumbling stone well said to grant wishes' },
        { icon: '💎', name: 'Crystal Formation', description: 'a cluster of glowing crystals jutting from the ground' },
        { icon: '🏚️', name: 'Abandoned Camp', description: 'the remains of a camp abandoned in a hurry' },
        { icon: '🪦', name: 'Old Grave', description: 'a weathered, unmarked grave overgrown with moss' },
        { icon: '🌸', name: 'Flower Patch', description: 'a patch of wildflowers blooming against the odds' },
        { icon: '🗿', name: 'Stone Idol', description: 'a moss-covered stone idol of a forgotten god' },
    ];

    // ---------- State ----------
    let species = [];
    let blobs = [];
    let scenes = [];
    let nextSpeciesId = 1;
    let nextBlobId = 1;
    let nextSceneId = 1;
    let selectedBlobId = null;
    let selectedSpeciesId = null;
    let paused = false;
    let aiEnabled = true;
    let activeRequests = 0;
    let requestCount = 0;

    // ---------- DOM ----------
    const canvas = document.getElementById('world');
    const ctx = canvas.getContext('2d');
    const feedEl = document.getElementById('feed');
    const speciesListEl = document.getElementById('speciesList');
    const detailPanel = document.getElementById('detailPanel');
    const detailSwatch = document.getElementById('detailSwatch');
    const detailName = document.getElementById('detailName');
    const detailSub = document.getElementById('detailSub');
    const conversationLog = document.getElementById('conversationLog');
    const conversationSection = document.getElementById('conversationSection');
    const relationshipList = document.getElementById('relationshipList');
    const relationshipSection = document.getElementById('relationshipSection');
    const debugSection = document.getElementById('debugSection');
    const debugRequest = document.getElementById('debugRequest');
    const debugResponse = document.getElementById('debugResponse');
    const energySection = document.getElementById('energySection');
    const energyFill = document.getElementById('energyFill');
    const fieldPersonality = document.getElementById('fieldPersonality');
    const fieldRole = document.getElementById('fieldRole');
    const fieldFaith = document.getElementById('fieldFaith');
    const fieldPurpose = document.getElementById('fieldPurpose');
    const savedIndicator = document.getElementById('savedIndicator');
    const budgetCounter = document.getElementById('budgetCounter');
    const aiToggleBtn = document.getElementById('aiToggleBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const resetBtn = document.getElementById('resetBtn');
    const addSpeciesBtn = document.getElementById('addSpeciesBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const addSpeciesModal = document.getElementById('addSpeciesModal');
    const addSpeciesForm = document.getElementById('addSpeciesForm');
    const closeDetailBtn = document.getElementById('closeDetailBtn');

    // ---------- Utility ----------
    const rand = (min, max) => min + Math.random() * (max - min);
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    function hexToRgb(hex) {
        const int = parseInt(hex.replace('#', ''), 16);
        return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
    }

    function rgbToHex({ r, g, b }) {
        return '#' + [r, g, b]
            .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
            .join('');
    }

    function blendColor(fromHex, towardHex, t) {
        const a = hexToRgb(fromHex);
        const b = hexToRgb(towardHex);
        return rgbToHex({
            r: a.r + (b.r - a.r) * t,
            g: a.g + (b.g - a.g) * t,
            b: a.b + (b.b - a.b) * t,
        });
    }

    function resizeCanvas() {
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }

    function spawnBlob(speciesObj) {
        blobs.push({
            id: nextBlobId++,
            speciesId: speciesObj.id,
            x: rand(40, canvas.width - 40),
            y: rand(40, canvas.height - 40),
            vx: rand(-1, 1) * SPEED,
            vy: rand(-1, 1) * SPEED,
            color: speciesObj.color,
            affinity: {},
            history: {},
            energy: ENERGY_MAX,
            phase: rand(0, Math.PI * 2),
            talkingWith: null,
            cooldownUntil: 0,
            log: [],
            lastRequest: null,
            lastResponse: null,
        });
    }

    function addSpecies(def, populationCount) {
        const s = {
            id: nextSpeciesId++,
            name: def.name,
            color: def.color,
            personality: def.personality,
            role: def.role,
            faith: def.faith,
            purpose: def.purpose,
        };
        species.push(s);
        for (let i = 0; i < populationCount; i++) spawnBlob(s);
        renderSpeciesList();
        return s;
    }

    function removeSpecies(speciesId) {
        species = species.filter((s) => s.id !== speciesId);
        blobs = blobs.filter((b) => b.speciesId !== speciesId);
        if (selectedBlobId && !blobs.find((b) => b.id === selectedBlobId)) {
            closeDetail();
        }
        if (selectedSpeciesId === speciesId) {
            closeDetail();
        }
        renderSpeciesList();
    }

    function getSpecies(id) {
        return species.find((s) => s.id === id);
    }

    // ---------- Default seed species ----------
    function seedDefaults() {
        addSpecies({
            name: 'Crimson',
            color: '#ff4d5e',
            personality: 'Bold, territorial, quick to challenge strangers',
            role: 'Wandering warriors who patrol their claimed ground',
            faith: 'Believe strength earned in the open is the only truth',
            purpose: 'Expand their territory and test the mettle of anyone they meet',
        }, 1);

        addSpecies({
            name: 'Azure',
            color: '#4d9bff',
            personality: 'Calm, curious, values dialogue over conflict',
            role: 'Scholars who record the history of every creature they encounter',
            faith: 'Believe every being carries a story worth understanding',
            purpose: 'Learn as much as possible before the world changes again',
        }, 1);

        addSpecies({
            name: 'Amber',
            color: '#ffb84d',
            personality: 'Playful, impulsive, easily distracted',
            role: 'Free spirits with no fixed allegiance',
            faith: 'Believe joy today matters more than plans for tomorrow',
            purpose: 'Chase whatever looks interesting and make friends along the way',
        }, 1);
    }

    // ---------- Scenes ----------
    function spawnScene(type) {
        scenes.push({
            id: nextSceneId++,
            icon: type.icon,
            name: type.name,
            description: type.description,
            x: rand(60, Math.max(60, canvas.width - 60)),
            y: rand(60, Math.max(60, canvas.height - 60)),
            radius: SCENE_PROXIMITY_RADIUS,
        });
    }

    function seedScenes() {
        const pool = SCENE_TYPES.slice();
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        pool.slice(0, SCENE_COUNT).forEach(spawnScene);
    }

    function findNearbyScene(x, y) {
        let found = null;
        let bestDist = Infinity;
        scenes.forEach((sc) => {
            const d = Math.hypot(sc.x - x, sc.y - y);
            if (d <= sc.radius && d < bestDist) { bestDist = d; found = sc; }
        });
        return found;
    }

    // Traces a soft, organic "slime" outline instead of a perfect circle: radius at each
    // angle is perturbed by a couple of desynced sine waves so each blob wobbles differently.
    function traceBlobShape(cx, cy, baseRadius, phase, t) {
        const points = [];
        for (let i = 0; i < WOBBLE_POINTS; i++) {
            const angle = (i / WOBBLE_POINTS) * Math.PI * 2;
            const wobble =
                Math.sin(angle * 3 + phase + t * WOBBLE_SPEED) * WOBBLE_AMPLITUDE * 0.6 +
                Math.sin(angle * 2 - phase * 1.3 + t * WOBBLE_SPEED * 0.7) * WOBBLE_AMPLITUDE * 0.4;
            const r = baseRadius + wobble;
            points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
        }

        const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const start = mid(points[points.length - 1], points[0]);

        ctx.beginPath();
        ctx.moveTo(start[0], start[1]);
        for (let i = 0; i < points.length; i++) {
            const cur = points[i];
            const next = points[(i + 1) % points.length];
            const m = mid(cur, next);
            ctx.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
        }
        ctx.closePath();
    }

    // ---------- Rendering ----------
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        scenes.forEach((sc) => {
            ctx.beginPath();
            ctx.arc(sc.x, sc.y, sc.radius, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.10)';
            ctx.setLineDash([4, 6]);
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.font = '22px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(sc.icon, sc.x, sc.y);

            ctx.font = '11px sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillText(sc.name, sc.x, sc.y + sc.radius * 0.55);
        });
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';

        // connecting lines for active conversations
        blobs.forEach((b) => {
            if (b.talkingWith && b.id < b.talkingWith) {
                const other = blobs.find((o) => o.id === b.talkingWith);
                if (other) {
                    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(b.x, b.y);
                    ctx.lineTo(other.x, other.y);
                    ctx.stroke();
                }
            }
        });

        const t = performance.now() / 1000;

        blobs.forEach((b) => {
            const s = getSpecies(b.speciesId);
            if (!s) return;
            traceBlobShape(b.x, b.y, BLOB_RADIUS, b.phase || 0, t);
            ctx.fillStyle = b.color || s.color;
            const energyAlpha = 0.4 + 0.45 * (b.energy / ENERGY_MAX);
            ctx.globalAlpha = b.talkingWith ? 1 : energyAlpha;
            ctx.fill();
            ctx.globalAlpha = 1;

            if (b.id === selectedBlobId) {
                ctx.beginPath();
                ctx.arc(b.x, b.y, BLOB_RADIUS + 4, 0, Math.PI * 2);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            if (b.talkingWith) {
                ctx.fillStyle = '#ffffff';
                ctx.font = '12px sans-serif';
                ctx.fillText('\u{1F4AC}', b.x - 7, b.y - BLOB_RADIUS - 6);
            }
        });
    }

    // ---------- Movement ----------
    function update() {
        const blobsById = new Map();
        blobs.forEach((b) => blobsById.set(b.id, b));

        decayAffinities();
        decayEnergy();

        blobs.forEach((b) => {
            if (b.talkingWith) return; // frozen mid-conversation

            b.vx += rand(-0.05, 0.05);
            b.vy += rand(-0.05, 0.05);

            applySocialForces(b, blobsById);

            const speed = Math.hypot(b.vx, b.vy) || 1;
            const cap = SPEED * 1.6;
            if (speed > cap) {
                b.vx = (b.vx / speed) * cap;
                b.vy = (b.vy / speed) * cap;
            }

            b.x += b.vx;
            b.y += b.vy;

            if (b.x < BLOB_RADIUS) { b.x = BLOB_RADIUS; b.vx *= -1; }
            if (b.x > canvas.width - BLOB_RADIUS) { b.x = canvas.width - BLOB_RADIUS; b.vx *= -1; }
            if (b.y < BLOB_RADIUS) { b.y = BLOB_RADIUS; b.vy *= -1; }
            if (b.y > canvas.height - BLOB_RADIUS) { b.y = canvas.height - BLOB_RADIUS; b.vy *= -1; }
        });

        checkEncounters();
    }

    function decayAffinities() {
        blobs.forEach((b) => {
            Object.keys(b.affinity).forEach((idStr) => {
                const score = b.affinity[idStr];
                if (score > 0) b.affinity[idStr] = Math.max(0, score - AFFINITY_DECAY_PER_FRAME);
                else if (score < 0) b.affinity[idStr] = Math.min(0, score + AFFINITY_DECAY_PER_FRAME);
            });
        });
    }

    function decayEnergy() {
        blobs.forEach((b) => {
            b.energy = Math.max(0, b.energy - ENERGY_DECAY_PER_FRAME);
        });
    }

    // Steer gently toward the blob this one likes most, and away from the one it likes least.
    // Also applies a baseline pull toward the nearest other blob so isolated blobs
    // still have a reason to close the gap before any relationship exists.
    function applySocialForces(b, blobsById) {
        let bestId = null, bestScore = LIKE_THRESHOLD;
        let worstId = null, worstScore = DISLIKE_THRESHOLD;
        let nearestId = null, nearestDist = Infinity;

        Object.keys(b.affinity).forEach((idStr) => {
            const id = Number(idStr);
            if (!blobsById.has(id)) return;
            const score = b.affinity[idStr];
            if (score > bestScore) { bestScore = score; bestId = id; }
            if (score < worstScore) { worstScore = score; worstId = id; }
        });

        blobsById.forEach((other, id) => {
            if (id === b.id) return;
            const dist = Math.hypot(other.x - b.x, other.y - b.y);
            if (dist < nearestDist) { nearestDist = dist; nearestId = id; }
        });

        if (nearestId !== null && nearestDist > ENCOUNTER_DISTANCE) {
            const target = blobsById.get(nearestId);
            const dx = target.x - b.x, dy = target.y - b.y;
            const urgency = 1 + (1 - b.energy / ENERGY_MAX) * ENERGY_URGENCY_MULTIPLIER;
            const pull = BASE_ATTRACT * urgency;
            b.vx += (dx / nearestDist) * pull;
            b.vy += (dy / nearestDist) * pull;
        }

        if (bestId !== null) {
            const target = blobsById.get(bestId);
            const dx = target.x - b.x, dy = target.y - b.y;
            const dist = Math.hypot(dx, dy) || 1;
            if (dist > ENCOUNTER_DISTANCE) {
                const pull = SOCIAL_ATTRACT * (bestScore / AFFINITY_MAX);
                b.vx += (dx / dist) * pull;
                b.vy += (dy / dist) * pull;
            }
        }

        if (worstId !== null) {
            const target = blobsById.get(worstId);
            const dx = b.x - target.x, dy = b.y - target.y;
            const dist = Math.hypot(dx, dy) || 1;
            if (dist < SOCIAL_REPEL_RANGE) {
                const push = SOCIAL_REPEL * (Math.abs(worstScore) / AFFINITY_MAX);
                b.vx += (dx / dist) * push;
                b.vy += (dy / dist) * push;
            }
        }
    }

    function checkEncounters() {
        if (!aiEnabled) return;
        const now = Date.now();

        for (let i = 0; i < blobs.length; i++) {
            const a = blobs[i];
            if (a.talkingWith || now < a.cooldownUntil) continue;

            for (let j = i + 1; j < blobs.length; j++) {
                const b = blobs[j];
                if (b.talkingWith || now < b.cooldownUntil) continue;

                const dist = Math.hypot(a.x - b.x, a.y - b.y);
                if (dist <= ENCOUNTER_DISTANCE) {
                    startConversation(a, b);
                    break;
                }
            }
        }
    }

    function startConversation(a, b) {
        if (activeRequests >= MAX_CONCURRENT_REQUESTS) return;
        if (requestCount >= SESSION_REQUEST_CAP) return;

        a.talkingWith = b.id;
        b.talkingWith = a.id;
        a.vx = a.vy = b.vx = b.vy = 0;

        const speciesA = getSpecies(a.speciesId);
        const speciesB = getSpecies(b.speciesId);
        if (!speciesA || !speciesB) {
            endConversation(a, b);
            return;
        }

        activeRequests++;
        requestCount++;
        updateBudgetCounter();

        const nearbyScene = findNearbyScene((a.x + b.x) / 2, (a.y + b.y) / 2);

        const requestBody = {
            blobA: { name: speciesA.name, personality: speciesA.personality, role: speciesA.role, faith: speciesA.faith, purpose: speciesA.purpose },
            blobB: { name: speciesB.name, personality: speciesB.personality, role: speciesB.role, faith: speciesB.faith, purpose: speciesB.purpose },
            priorEncounters: a.history[b.id] || [],
            affinity: a.affinity[b.id] || 0,
            scene: nearbyScene ? { name: nearbyScene.name, description: nearbyScene.description } : null,
        };
        a.lastRequest = requestBody;
        b.lastRequest = requestBody;

        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        })
            .then((res) => res.json())
            .then((data) => {
                a.lastResponse = data;
                b.lastResponse = data;
                applyConversationResult(a, b, speciesA, speciesB, data, nearbyScene);
            })
            .catch(() => {
                appendLog(a, { who: 'System', text: 'Could not reach the AI narrator.' });
            })
            .finally(() => {
                activeRequests--;
                endConversation(a, b);
            });
    }

    function applyConversationResult(a, b, speciesA, speciesB, data, nearbyScene) {
        const lines = Array.isArray(data.lines) ? data.lines : [];
        lines.forEach((line) => {
            const who = line.speaker === 'B' ? speciesB.name : speciesA.name;
            const entry = { who, text: line.text };
            appendLog(a, entry);
            appendLog(b, entry);
        });

        const outcome = data.outcome || 'neutral';
        const winner = data.winner === 'A' || data.winner === 'B' ? data.winner : 'tie';
        applyOutcome(a, b, outcome);
        updateRelationship(a, b, outcome, winner);
        restoreEnergy(a, b, outcome);
        recordHistory(a, b, data.summary || 'They exchanged a few words.');
        pushFeed(speciesA, speciesB, data.summary || '', outcome, nearbyScene);

        if (selectedBlobId === a.id || selectedBlobId === b.id) {
            renderDetail();
        }
    }

    function applyOutcome(a, b, outcome) {
        const dx = b.x - a.x || 0.01;
        const dy = b.y - a.y || 0.01;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = dx / dist, ny = dy / dist;

        if (outcome === 'hostile') {
            a.vx = -nx * SPEED * 2; a.vy = -ny * SPEED * 2;
            b.vx = nx * SPEED * 2; b.vy = ny * SPEED * 2;
        } else if (outcome === 'friendly') {
            const sharedX = rand(-1, 1) * SPEED * 0.6;
            const sharedY = rand(-1, 1) * SPEED * 0.6;
            a.vx = sharedX; a.vy = sharedY;
            b.vx = sharedX; b.vy = sharedY;
        } else {
            a.vx = rand(-1, 1) * SPEED; a.vy = rand(-1, 1) * SPEED;
            b.vx = rand(-1, 1) * SPEED; b.vy = rand(-1, 1) * SPEED;
        }
    }

    const MAX_HISTORY_ITEMS = 3;

    function recordHistory(a, b, summary) {
        if (!a.history[b.id]) a.history[b.id] = [];
        if (!b.history[a.id]) b.history[a.id] = [];
        a.history[b.id].push(summary);
        b.history[a.id].push(summary);
        if (a.history[b.id].length > MAX_HISTORY_ITEMS) a.history[b.id].shift();
        if (b.history[a.id].length > MAX_HISTORY_ITEMS) b.history[a.id].shift();
    }

    // Winner/loser diverge instead of mirroring: the winner barely moves (stays who they
    // were), the loser swings harder toward the winner - in relationship score and in
    // color - so repeated wins compound into one side's identity spreading, rather than
    // both sides drifting toward a shared average every time.
    function updateRelationship(a, b, outcome, winner) {
        const base = outcome === 'friendly' ? FRIENDLY_AFFINITY_DELTA
            : outcome === 'hostile' ? HOSTILE_AFFINITY_DELTA
            : NEUTRAL_AFFINITY_DELTA;

        let deltaA = base, deltaB = base;
        if (winner === 'A') {
            deltaA = base * WINNER_AFFINITY_SCALE;
            deltaB = base * LOSER_AFFINITY_SCALE;
        } else if (winner === 'B') {
            deltaB = base * WINNER_AFFINITY_SCALE;
            deltaA = base * LOSER_AFFINITY_SCALE;
        }

        a.affinity[b.id] = clamp((a.affinity[b.id] || 0) + deltaA, AFFINITY_MIN, AFFINITY_MAX);
        b.affinity[a.id] = clamp((b.affinity[a.id] || 0) + deltaB, AFFINITY_MIN, AFFINITY_MAX);

        if (outcome === 'friendly') {
            const aColorBefore = a.color;
            const bColorBefore = b.color;
            if (winner === 'A') {
                a.color = blendColor(aColorBefore, bColorBefore, COLOR_BLEND_FACTOR * WINNER_COLOR_SCALE);
                b.color = blendColor(bColorBefore, aColorBefore, COLOR_BLEND_FACTOR * LOSER_COLOR_SCALE);
            } else if (winner === 'B') {
                b.color = blendColor(bColorBefore, aColorBefore, COLOR_BLEND_FACTOR * WINNER_COLOR_SCALE);
                a.color = blendColor(aColorBefore, bColorBefore, COLOR_BLEND_FACTOR * LOSER_COLOR_SCALE);
            } else {
                a.color = blendColor(aColorBefore, bColorBefore, COLOR_BLEND_FACTOR);
                b.color = blendColor(bColorBefore, aColorBefore, COLOR_BLEND_FACTOR);
            }
        }
    }

    function restoreEnergy(a, b, outcome) {
        const amount = ENERGY_RESTORE[outcome] ?? ENERGY_RESTORE.neutral;
        a.energy = clamp(a.energy + amount, 0, ENERGY_MAX);
        b.energy = clamp(b.energy + amount, 0, ENERGY_MAX);
    }

    function endConversation(a, b) {
        a.talkingWith = null;
        b.talkingWith = null;
        a.cooldownUntil = Date.now() + TALK_COOLDOWN_MS;
        b.cooldownUntil = Date.now() + TALK_COOLDOWN_MS;
    }

    function appendLog(blob, entry) {
        blob.log.push(entry);
        if (blob.log.length > 20) blob.log.shift();
    }

    const FEED_ITEM_TTL_MS = 5000;

    function pushFeed(speciesA, speciesB, summary, outcome, nearbyScene) {
        const item = document.createElement('div');
        item.className = 'feed-item';
        const outcomeLabel = outcome === 'friendly' ? '🤝' : outcome === 'hostile' ? '⚔️' : '💬';
        const sceneTag = nearbyScene ? ` <em>near ${escapeHtml(nearbyScene.name)}</em>` : '';
        item.innerHTML = `${outcomeLabel} <strong>${escapeHtml(speciesA.name)}</strong> &amp; <strong>${escapeHtml(speciesB.name)}</strong>${sceneTag}: ${escapeHtml(summary)}`;
        makeSwipeToDismiss(item);
        feedEl.appendChild(item);
        item._ttlTimer = setTimeout(() => dismissFeedItem(item, 1), FEED_ITEM_TTL_MS);
        while (feedEl.children.length > FEED_ITEM_LIMIT) {
            feedEl.removeChild(feedEl.firstChild);
        }
    }

    function dismissFeedItem(item, dir) {
        if (item.dataset.dismissing === '1') return;
        item.dataset.dismissing = '1';
        if (item._ttlTimer) clearTimeout(item._ttlTimer);
        item.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        item.style.transform = `translateX(${dir * 400}px)`;
        item.style.opacity = '0';
        setTimeout(() => item.remove(), 200);
    }

    const SWIPE_DISMISS_THRESHOLD = 60;

    function makeSwipeToDismiss(item) {
        let startX = 0;
        let dx = 0;
        let dragging = false;

        item.addEventListener('pointerdown', (e) => {
            dragging = true;
            startX = e.clientX;
            dx = 0;
            item.style.transition = 'none';
            item.setPointerCapture(e.pointerId);
        });

        item.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            dx = e.clientX - startX;
            item.style.transform = `translateX(${dx}px)`;
            item.style.opacity = String(Math.max(0, 1 - Math.abs(dx) / 120));
        });

        const endDrag = () => {
            if (!dragging) return;
            dragging = false;
            if (Math.abs(dx) > SWIPE_DISMISS_THRESHOLD) {
                dismissFeedItem(item, dx > 0 ? 1 : -1);
            } else {
                item.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
                item.style.transform = 'translateX(0)';
                item.style.opacity = '1';
            }
        };

        item.addEventListener('pointerup', endDrag);
        item.addEventListener('pointercancel', endDrag);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function updateBudgetCounter() {
        budgetCounter.textContent = `AI: ${requestCount} / ${SESSION_REQUEST_CAP}`;
    }

    // ---------- Species sidebar ----------
    function renderSpeciesList() {
        speciesListEl.innerHTML = '';
        species.forEach((s) => {
            const count = blobs.filter((b) => b.speciesId === s.id).length;
            const li = document.createElement('li');
            li.className = 'species-item';
            li.innerHTML = `
                <span class="species-dot" style="background:${s.color}"></span>
                <span class="species-item-name">${escapeHtml(s.name)}</span>
                <span class="species-item-count">${count}</span>
                <button class="species-remove" title="Remove species"><i class="fas fa-trash"></i></button>
            `;
            li.querySelector('.species-remove').addEventListener('click', () => {
                if (confirm(`Remove ${s.name} and all its blobs?`)) removeSpecies(s.id);
            });
            li.querySelector('.species-item-name').addEventListener('click', () => selectSpecies(s.id));
            speciesListEl.appendChild(li);
        });
    }

    // ---------- Detail panel ----------
    function selectBlob(blob) {
        selectedBlobId = blob.id;
        selectedSpeciesId = null;
        detailPanel.hidden = false;
        renderDetail();
    }

    function selectSpecies(speciesId) {
        selectedSpeciesId = speciesId;
        selectedBlobId = null;
        detailPanel.hidden = false;
        renderDetail();
    }

    function closeDetail() {
        selectedBlobId = null;
        selectedSpeciesId = null;
        detailPanel.hidden = true;
    }

    function getSelectedSpecies() {
        if (selectedBlobId !== null) {
            const blob = blobs.find((b) => b.id === selectedBlobId);
            return blob ? getSpecies(blob.speciesId) : null;
        }
        if (selectedSpeciesId !== null) {
            return getSpecies(selectedSpeciesId);
        }
        return null;
    }

    function renderDetail() {
        if (selectedBlobId !== null) {
            renderBlobDetail();
        } else if (selectedSpeciesId !== null) {
            renderSpeciesDetail();
        } else {
            closeDetail();
        }
    }

    function renderBlobDetail() {
        const blob = blobs.find((b) => b.id === selectedBlobId);
        if (!blob) { closeDetail(); return; }
        const s = getSpecies(blob.speciesId);
        if (!s) { closeDetail(); return; }

        conversationSection.hidden = false;
        relationshipSection.hidden = false;
        energySection.hidden = false;
        debugSection.hidden = false;

        detailSwatch.style.background = blob.color || s.color;
        detailName.textContent = s.name;
        detailSub.textContent = `Individual #${blob.id}`;
        renderEnergyBar(blob);
        debugRequest.textContent = blob.lastRequest ? JSON.stringify(blob.lastRequest, null, 2) : 'No AI calls yet.';
        debugResponse.textContent = blob.lastResponse ? JSON.stringify(blob.lastResponse, null, 2) : 'No AI calls yet.';

        conversationLog.innerHTML = '';
        if (blob.log.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'conversation-empty';
            empty.textContent = 'No conversations yet. Wait for this blob to encounter another.';
            conversationLog.appendChild(empty);
        } else {
            blob.log.forEach((entry) => {
                const line = document.createElement('div');
                line.className = 'conversation-line';
                line.innerHTML = `<span class="who">${escapeHtml(entry.who)}:</span>${escapeHtml(entry.text)}`;
                conversationLog.appendChild(line);
            });
            conversationLog.scrollTop = conversationLog.scrollHeight;
        }

        renderRelationships(blob);
        fillPromptFields(s);
    }

    function renderSpeciesDetail() {
        const s = getSpecies(selectedSpeciesId);
        if (!s) { closeDetail(); return; }

        conversationSection.hidden = true;
        relationshipSection.hidden = true;
        energySection.hidden = true;
        debugSection.hidden = true;

        detailSwatch.style.background = s.color;
        detailName.textContent = s.name;
        detailSub.textContent = `Species Bio · ${blobs.filter((b) => b.speciesId === s.id).length} alive`;

        fillPromptFields(s);
    }

    function renderEnergyBar(blob) {
        const pct = clamp(blob.energy, 0, ENERGY_MAX);
        energyFill.style.width = pct + '%';
        energyFill.style.background = pct > 60 ? '#39d98a' : pct > 30 ? '#ffb84d' : '#ff5b6e';
    }

    function fillPromptFields(s) {
        fieldPersonality.value = s.personality;
        fieldRole.value = s.role;
        fieldFaith.value = s.faith;
        fieldPurpose.value = s.purpose;
    }

    function renderRelationships(blob) {
        const entries = Object.keys(blob.affinity)
            .map((idStr) => {
                const other = blobs.find((o) => o.id === Number(idStr));
                return other ? { other, score: blob.affinity[idStr] } : null;
            })
            .filter(Boolean)
            .sort((x, y) => y.score - x.score);

        relationshipList.innerHTML = '';
        if (entries.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'conversation-empty';
            empty.textContent = 'No relationships yet.';
            relationshipList.appendChild(empty);
            return;
        }

        entries.forEach(({ other, score }) => {
            const otherSpecies = getSpecies(other.speciesId);
            const mood = score >= LIKE_THRESHOLD ? '\u{1F91D}' : score <= DISLIKE_THRESHOLD ? '⚔️' : '➖';
            const rounded = Math.round(score);
            const sign = rounded > 0 ? '+' : '';
            const summaries = (blob.history[other.id] || []).slice().reverse();

            const row = document.createElement('div');
            row.className = 'relationship-row';
            row.innerHTML = `
                <div class="relationship-header">
                    <span class="relationship-dot" style="background:${(other.color || (otherSpecies && otherSpecies.color)) || '#888'}"></span>
                    <span class="relationship-name">${escapeHtml(otherSpecies ? otherSpecies.name : '?')} #${other.id}</span>
                    <span class="relationship-score ${rounded >= 0 ? 'positive' : 'negative'}">${mood} ${sign}${rounded}</span>
                </div>
                <ul class="relationship-history">
                    ${summaries.length
                        ? summaries.map((s) => `<li>${escapeHtml(s)}</li>`).join('')
                        : '<li>No details recorded yet.</li>'}
                </ul>
            `;
            relationshipList.appendChild(row);
        });
    }

    function flashSaved() {
        savedIndicator.classList.add('show');
        clearTimeout(flashSaved._t);
        flashSaved._t = setTimeout(() => savedIndicator.classList.remove('show'), 900);
    }

    [
        [fieldPersonality, 'personality'],
        [fieldRole, 'role'],
        [fieldFaith, 'faith'],
        [fieldPurpose, 'purpose'],
    ].forEach(([el, key]) => {
        el.addEventListener('input', () => {
            const s = getSelectedSpecies();
            if (!s) return;
            s[key] = el.value;
            flashSaved();
        });
    });

    closeDetailBtn.addEventListener('click', closeDetail);

    // ---------- Canvas interaction ----------
    canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        let hit = null;
        let hitDist = Infinity;
        blobs.forEach((b) => {
            const d = Math.hypot(b.x - x, b.y - y);
            if (d <= BLOB_RADIUS + TAP_TOLERANCE && d < hitDist) { hit = b; hitDist = d; }
        });

        if (hit) selectBlob(hit);
        else closeDetail();
    });

    // ---------- Top controls ----------
    function syncPauseButton() {
        pauseBtn.innerHTML = paused
            ? '<i class="fas fa-play"></i> Resume'
            : '<i class="fas fa-pause"></i> Pause';
    }

    function syncAiToggleButton() {
        aiToggleBtn.innerHTML = aiEnabled
            ? '<i class="fas fa-brain"></i> AI: On'
            : '<i class="fas fa-brain"></i> AI: Off';
        aiToggleBtn.classList.toggle('off', !aiEnabled);
    }

    pauseBtn.addEventListener('click', () => {
        paused = !paused;
        syncPauseButton();
    });

    aiToggleBtn.addEventListener('click', () => {
        aiEnabled = !aiEnabled;
        syncAiToggleButton();
    });

    function resetSimulation() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }

        species = [];
        blobs = [];
        scenes = [];
        nextSpeciesId = 1;
        nextBlobId = 1;
        nextSceneId = 1;
        requestCount = 0;
        activeRequests = 0;
        paused = false;
        aiEnabled = true;

        closeDetail();
        addSpeciesModal.hidden = true;
        feedEl.innerHTML = '';

        seedDefaults();
        seedScenes();
        updateBudgetCounter();
        syncAiToggleButton();
        syncPauseButton();
    }

    resetBtn.addEventListener('click', () => {
        if (confirm('Reset the whole simulation? This permanently clears all species, blobs, relationships, and history.')) {
            resetSimulation();
        }
    });

    // ---------- Add species modal ----------
    // ---------- Random species draft ----------
    const RANDOM_NAMES = [
        'Verdant', 'Obsidian', 'Cerulean', 'Umber', 'Ivory', 'Vermillion', 'Slate', 'Coral',
        'Indigo', 'Saffron', 'Onyx', 'Jade', 'Rosewood', 'Cobalt', 'Marigold', 'Charcoal',
        'Pearl', 'Ember', 'Frost', 'Moss', 'Amethyst', 'Bronze', 'Opal', 'Scarlet',
    ];
    const RANDOM_COLORS = [
        '#ff4d5e', '#4d9bff', '#ffb84d', '#39d98a', '#c65dff', '#ff6fae', '#5de0e6', '#f4d35e',
        '#ff8552', '#7ee8fa', '#b892ff', '#63e6be', '#ffa8a8', '#74c69d', '#e0aaff', '#ffd166',
    ];
    const RANDOM_PERSONALITIES = [
        'Bold, territorial, quick to challenge strangers',
        'Calm, curious, values dialogue over conflict',
        'Playful, impulsive, easily distracted',
        'Cautious, observant, slow to trust',
        'Proud, ambitious, hungry for recognition',
        'Gentle, empathetic, quick to forgive',
        'Mysterious, aloof, reveals little',
        'Stubborn, principled, rarely backs down',
        'Cheerful, generous, makes friends easily',
        'Restless, wandering, never stays long',
    ];
    const RANDOM_ROLES = [
        'Wandering warriors who patrol their claimed ground',
        'Scholars who record the history of every creature they encounter',
        'Free spirits with no fixed allegiance',
        'Traders who barter stories instead of goods',
        'Hermits who keep to the edges of the world',
        'Messengers who carry news between distant strangers',
        'Guardians sworn to protect a forgotten promise',
        'Explorers charting territory no one else dares to enter',
        'Healers who tend to whoever they find in need',
        'Outcasts searching for a place to belong',
    ];
    const RANDOM_FAITHS = [
        'Believe strength earned in the open is the only truth',
        'Believe every being carries a story worth understanding',
        'Believe joy today matters more than plans for tomorrow',
        'Believe fate rewards those who wait patiently',
        'Believe every encounter carries a hidden lesson',
        'Believe the world only rewards the bold',
        'Believe kindness is repaid in kind, eventually',
        'Believe nothing lasts, so nothing is worth clinging to',
        'Believe every stranger is a friend not yet made',
        'Believe silence holds more truth than words',
    ];
    const RANDOM_PURPOSES = [
        'Expand their territory and test the mettle of anyone they meet',
        'Learn as much as possible before the world changes again',
        'Chase whatever looks interesting and make friends along the way',
        'Find a rival worth respecting',
        'Collect stories from every creature they meet',
        'Search for a place they can finally call home',
        "Protect the few bonds they've already made",
        "Prove themselves to a world that hasn't noticed them yet",
        'Spread their beliefs to anyone willing to listen',
        'Simply survive, one encounter at a time',
    ];

    const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

    function randomSpeciesDraft() {
        let name = pickRandom(RANDOM_NAMES);
        const usedNames = new Set(species.map((s) => s.name.toLowerCase()));
        if (usedNames.has(name.toLowerCase())) {
            let suffix = 2;
            while (usedNames.has(`${name} ${suffix}`.toLowerCase())) suffix++;
            name = `${name} ${suffix}`;
        }

        let color = pickRandom(RANDOM_COLORS);
        const usedColors = new Set(species.map((s) => s.color.toLowerCase()));
        for (let i = 0; i < RANDOM_COLORS.length && usedColors.has(color.toLowerCase()); i++) {
            color = pickRandom(RANDOM_COLORS);
        }

        return {
            name,
            color,
            personality: pickRandom(RANDOM_PERSONALITIES),
            role: pickRandom(RANDOM_ROLES),
            faith: pickRandom(RANDOM_FAITHS),
            purpose: pickRandom(RANDOM_PURPOSES),
        };
    }

    function fillRandomSpeciesDraft() {
        const draft = randomSpeciesDraft();
        document.getElementById('newName').value = draft.name;
        document.getElementById('newColor').value = draft.color;
        document.getElementById('newPersonality').value = draft.personality;
        document.getElementById('newRole').value = draft.role;
        document.getElementById('newFaith').value = draft.faith;
        document.getElementById('newPurpose').value = draft.purpose;
        document.getElementById('newPopulation').value = 1;
    }

    addSpeciesBtn.addEventListener('click', () => {
        fillRandomSpeciesDraft();
        addSpeciesModal.hidden = false;
    });
    closeModalBtn.addEventListener('click', () => { addSpeciesModal.hidden = true; });
    addSpeciesModal.addEventListener('click', (e) => {
        if (e.target === addSpeciesModal) addSpeciesModal.hidden = true;
    });

    addSpeciesForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('newName').value.trim();
        if (!name) return;
        const population = clamp(parseInt(document.getElementById('newPopulation').value, 10) || 1, 1, 20);

        addSpecies({
            name,
            color: document.getElementById('newColor').value,
            personality: document.getElementById('newPersonality').value.trim() || 'Undefined',
            role: document.getElementById('newRole').value.trim() || 'Undefined',
            faith: document.getElementById('newFaith').value.trim() || 'Undefined',
            purpose: document.getElementById('newPurpose').value.trim() || 'Undefined',
        }, population);

        addSpeciesForm.reset();
        document.getElementById('newColor').value = '#39d98a';
        document.getElementById('newPopulation').value = 1;
        addSpeciesModal.hidden = true;
    });

    // ---------- Persistence ----------
    function serializeState() {
        return {
            version: 1,
            species,
            blobs,
            scenes,
            nextSpeciesId,
            nextBlobId,
            nextSceneId,
            requestCount,
            aiEnabled,
            paused,
        };
    }

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
        } catch (err) {
            // localStorage unavailable or full; nothing we can do, just skip saving
        }
    }

    function loadState() {
        let raw;
        try {
            raw = localStorage.getItem(STORAGE_KEY);
        } catch (err) {
            return false;
        }
        if (!raw) return false;

        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            return false;
        }
        if (!data || !Array.isArray(data.species) || !Array.isArray(data.blobs) || data.blobs.length === 0) {
            return false;
        }

        species = data.species;
        blobs = data.blobs.map((b) => ({
            ...b,
            x: clamp(b.x, BLOB_RADIUS, Math.max(BLOB_RADIUS, canvas.width - BLOB_RADIUS)),
            y: clamp(b.y, BLOB_RADIUS, Math.max(BLOB_RADIUS, canvas.height - BLOB_RADIUS)),
            affinity: b.affinity || {},
            history: b.history || {},
            log: b.log || [],
            energy: typeof b.energy === 'number' ? b.energy : ENERGY_MAX,
            phase: typeof b.phase === 'number' ? b.phase : rand(0, Math.PI * 2),
            talkingWith: null,
            cooldownUntil: 0,
            lastRequest: null,
            lastResponse: null,
        }));
        scenes = Array.isArray(data.scenes) && data.scenes.length > 0
            ? data.scenes.map((sc) => ({
                ...sc,
                x: clamp(sc.x, 30, Math.max(30, canvas.width - 30)),
                y: clamp(sc.y, 30, Math.max(30, canvas.height - 30)),
                radius: typeof sc.radius === 'number' ? sc.radius : SCENE_PROXIMITY_RADIUS,
            }))
            : null;

        nextSpeciesId = data.nextSpeciesId || Math.max(0, ...species.map((s) => s.id)) + 1;
        nextBlobId = data.nextBlobId || Math.max(0, ...blobs.map((b) => b.id)) + 1;
        nextSceneId = data.nextSceneId || (scenes ? Math.max(0, ...scenes.map((sc) => sc.id)) + 1 : 1);
        requestCount = typeof data.requestCount === 'number' ? data.requestCount : 0;
        aiEnabled = typeof data.aiEnabled === 'boolean' ? data.aiEnabled : true;
        paused = typeof data.paused === 'boolean' ? data.paused : false;

        if (!scenes) {
            scenes = [];
            seedScenes();
        }

        renderSpeciesList();
        updateBudgetCounter();
        syncAiToggleButton();
        syncPauseButton();
        return true;
    }

    // ---------- Main loop ----------
    function tick() {
        if (!paused) update();
        draw();
        if (selectedBlobId !== null && !paused) {
            const blob = blobs.find((b) => b.id === selectedBlobId);
            if (blob) renderEnergyBar(blob);
        }
        requestAnimationFrame(tick);
    }

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('beforeunload', saveState);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) saveState();
    });
    setInterval(saveState, AUTOSAVE_INTERVAL_MS);

    resizeCanvas();
    if (!loadState()) {
        seedDefaults();
        seedScenes();
    }
    updateBudgetCounter();
    requestAnimationFrame(tick);
})();
