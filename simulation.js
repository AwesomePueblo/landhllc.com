(function () {
    'use strict';

    // ---------- Config ----------
    const BLOB_RADIUS = 10;
    const ENCOUNTER_DISTANCE = 26;
    const TAP_TOLERANCE = 16; // extra hit-test radius beyond the visual blob, for touch/finger taps
    const TALK_COOLDOWN_MS = 15000;
    const MAX_CONCURRENT_REQUESTS = 2;
    const SESSION_REQUEST_CAP = 60;
    const SPEED = 0.35;
    const FEED_ITEM_LIMIT = 6;

    const AFFINITY_MIN = -100;
    const AFFINITY_MAX = 100;
    const FRIENDLY_AFFINITY_DELTA = 15;
    const HOSTILE_AFFINITY_DELTA = -20;
    const NEUTRAL_AFFINITY_DELTA = 2;
    const COLOR_BLEND_FACTOR = 0.12;
    const LIKE_THRESHOLD = 20;
    const DISLIKE_THRESHOLD = -20;
    const SOCIAL_ATTRACT = 0.03;
    const SOCIAL_REPEL = 0.03;
    const SOCIAL_REPEL_RANGE = 160;
    const BASE_ATTRACT = 0.018; // baseline pull toward the nearest other blob, active before any relationship exists

    // ---------- State ----------
    let species = [];
    let blobs = [];
    let nextSpeciesId = 1;
    let nextBlobId = 1;
    let selectedBlobId = null;
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
    const relationshipList = document.getElementById('relationshipList');
    const fieldPersonality = document.getElementById('fieldPersonality');
    const fieldRole = document.getElementById('fieldRole');
    const fieldFaith = document.getElementById('fieldFaith');
    const fieldPurpose = document.getElementById('fieldPurpose');
    const savedIndicator = document.getElementById('savedIndicator');
    const budgetCounter = document.getElementById('budgetCounter');
    const aiToggleBtn = document.getElementById('aiToggleBtn');
    const pauseBtn = document.getElementById('pauseBtn');
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
            talkingWith: null,
            cooldownUntil: 0,
            log: [],
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

    // ---------- Rendering ----------
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

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

        blobs.forEach((b) => {
            const s = getSpecies(b.speciesId);
            if (!s) return;
            ctx.beginPath();
            ctx.arc(b.x, b.y, BLOB_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = b.color || s.color;
            ctx.globalAlpha = b.talkingWith ? 1 : 0.85;
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
            b.vx += (dx / nearestDist) * BASE_ATTRACT;
            b.vy += (dy / nearestDist) * BASE_ATTRACT;
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

        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                blobA: { name: speciesA.name, personality: speciesA.personality, role: speciesA.role, faith: speciesA.faith, purpose: speciesA.purpose },
                blobB: { name: speciesB.name, personality: speciesB.personality, role: speciesB.role, faith: speciesB.faith, purpose: speciesB.purpose },
            }),
        })
            .then((res) => res.json())
            .then((data) => {
                applyConversationResult(a, b, speciesA, speciesB, data);
            })
            .catch(() => {
                appendLog(a, { who: 'System', text: 'Could not reach the AI narrator.' });
            })
            .finally(() => {
                activeRequests--;
                endConversation(a, b);
            });
    }

    function applyConversationResult(a, b, speciesA, speciesB, data) {
        const lines = Array.isArray(data.lines) ? data.lines : [];
        lines.forEach((line) => {
            const who = line.speaker === 'B' ? speciesB.name : speciesA.name;
            const entry = { who, text: line.text };
            appendLog(a, entry);
            appendLog(b, entry);
        });

        const outcome = data.outcome || 'neutral';
        applyOutcome(a, b, outcome);
        updateRelationship(a, b, outcome);
        pushFeed(speciesA, speciesB, data.summary || '', outcome);

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

    function updateRelationship(a, b, outcome) {
        const delta = outcome === 'friendly' ? FRIENDLY_AFFINITY_DELTA
            : outcome === 'hostile' ? HOSTILE_AFFINITY_DELTA
            : NEUTRAL_AFFINITY_DELTA;

        a.affinity[b.id] = clamp((a.affinity[b.id] || 0) + delta, AFFINITY_MIN, AFFINITY_MAX);
        b.affinity[a.id] = clamp((b.affinity[a.id] || 0) + delta, AFFINITY_MIN, AFFINITY_MAX);

        if (outcome === 'friendly') {
            const newAColor = blendColor(a.color, b.color, COLOR_BLEND_FACTOR);
            const newBColor = blendColor(b.color, a.color, COLOR_BLEND_FACTOR);
            a.color = newAColor;
            b.color = newBColor;
        }
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

    function pushFeed(speciesA, speciesB, summary, outcome) {
        const item = document.createElement('div');
        item.className = 'feed-item';
        const outcomeLabel = outcome === 'friendly' ? '🤝' : outcome === 'hostile' ? '⚔️' : '💬';
        item.innerHTML = `${outcomeLabel} <strong>${escapeHtml(speciesA.name)}</strong> &amp; <strong>${escapeHtml(speciesB.name)}</strong>: ${escapeHtml(summary)}`;
        feedEl.appendChild(item);
        while (feedEl.children.length > FEED_ITEM_LIMIT) {
            feedEl.removeChild(feedEl.firstChild);
        }
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
            speciesListEl.appendChild(li);
        });
    }

    // ---------- Detail panel ----------
    function selectBlob(blob) {
        selectedBlobId = blob.id;
        detailPanel.hidden = false;
        renderDetail();
    }

    function closeDetail() {
        selectedBlobId = null;
        detailPanel.hidden = true;
    }

    function renderDetail() {
        const blob = blobs.find((b) => b.id === selectedBlobId);
        if (!blob) { closeDetail(); return; }
        const s = getSpecies(blob.speciesId);
        if (!s) { closeDetail(); return; }

        detailSwatch.style.background = blob.color || s.color;
        detailName.textContent = s.name;
        detailSub.textContent = `Individual #${blob.id}`;

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
            const sign = score > 0 ? '+' : '';
            const row = document.createElement('div');
            row.className = 'relationship-row';
            row.innerHTML = `
                <span class="relationship-dot" style="background:${(other.color || (otherSpecies && otherSpecies.color)) || '#888'}"></span>
                <span class="relationship-name">${escapeHtml(otherSpecies ? otherSpecies.name : '?')} #${other.id}</span>
                <span class="relationship-score ${score >= 0 ? 'positive' : 'negative'}">${mood} ${sign}${score}</span>
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
            const blob = blobs.find((b) => b.id === selectedBlobId);
            if (!blob) return;
            const s = getSpecies(blob.speciesId);
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
    pauseBtn.addEventListener('click', () => {
        paused = !paused;
        pauseBtn.innerHTML = paused
            ? '<i class="fas fa-play"></i> Resume'
            : '<i class="fas fa-pause"></i> Pause';
    });

    aiToggleBtn.addEventListener('click', () => {
        aiEnabled = !aiEnabled;
        aiToggleBtn.innerHTML = aiEnabled
            ? '<i class="fas fa-brain"></i> AI: On'
            : '<i class="fas fa-brain"></i> AI: Off';
        aiToggleBtn.classList.toggle('off', !aiEnabled);
    });

    // ---------- Add species modal ----------
    addSpeciesBtn.addEventListener('click', () => { addSpeciesModal.hidden = false; });
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

    // ---------- Main loop ----------
    function tick() {
        if (!paused) update();
        draw();
        requestAnimationFrame(tick);
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    seedDefaults();
    updateBudgetCounter();
    requestAnimationFrame(tick);
})();
