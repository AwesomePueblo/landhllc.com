const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.SIM_MODEL || 'claude-haiku-4-5-20251001';
const MAX_FIELD_LEN = 300;

const MAX_HISTORY_ITEMS = 3;

const sanitize = (value) =>
  String(value || '').slice(0, MAX_FIELD_LEN).replace(/[\r\n]+/g, ' ').trim();

const describeCreature = (creature, label) =>
  `${label}: name="${sanitize(creature.name)}", personality="${sanitize(creature.personality)}", ` +
  `role="${sanitize(creature.role)}", faith="${sanitize(creature.faith)}", purpose="${sanitize(creature.purpose)}"`;

const describeScene = (scene) => {
  if (!scene || !scene.name) return 'They are out in the open, no particular landmark nearby.';
  return `Setting: they are near ${sanitize(scene.name)} — ${sanitize(scene.description)}. ` +
    'Let the setting color the encounter naturally (something to react to, a reason to linger) without forcing it.';
};

const describeHistory = (priorEncounters, affinity) => {
  const encounters = Array.isArray(priorEncounters) ? priorEncounters.slice(-MAX_HISTORY_ITEMS) : [];
  if (encounters.length === 0) {
    return 'This is the first time these two creatures have ever met.';
  }
  const relation = affinity >= 20 ? 'they have grown to like each other'
    : affinity <= -20 ? 'they have grown to resent each other'
    : "they're still feeling each other out";
  const recap = encounters.map((s, i) => `${i + 1}. ${sanitize(s)}`).join(' ');
  return `They have met ${encounters.length} time(s) before and ${relation} (relationship score ${affinity}). ` +
    `What happened previously: ${recap}`;
};

const SYSTEM_PROMPT =
  'You are the narrative engine for a 2D life simulation game. Two creatures have just encountered ' +
  'each other in the world. Write a brief, natural in-character exchange between them (2 to 4 short ' +
  "lines total, alternating speakers A and B) consistent with each creature's personality, role, faith, " +
  'and purpose. If they have history together, the dialogue should acknowledge and build on it — ' +
  'reference what happened before, let the relationship grow or sour further, rather than greeting ' +
  'each other as strangers. Then classify the overall outcome of the encounter. Call the record_encounter ' +
  'tool with your result — do not respond in plain text.';

const ENCOUNTER_TOOL = {
  name: 'record_encounter',
  description: 'Record the dialogue and outcome of an encounter between two creatures.',
  input_schema: {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            speaker: { type: 'string', enum: ['A', 'B'] },
            text: { type: 'string' },
          },
          required: ['speaker', 'text'],
        },
      },
      outcome: { type: 'string', enum: ['friendly', 'neutral', 'hostile'] },
      summary: { type: 'string', description: 'One short sentence summarizing what happened.' },
    },
    required: ['lines', 'outcome', 'summary'],
  },
};

const fallbackResponse = (summary) => ({
  lines: [{ speaker: 'A', text: '...' }],
  outcome: 'neutral',
  summary,
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured on this Netlify site' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { blobA, blobB, priorEncounters, affinity, scene } = payload;
  if (!blobA || !blobB) {
    return { statusCode: 400, body: JSON.stringify({ error: 'blobA and blobB are required' }) };
  }

  const userMessage =
    `${describeCreature(blobA, 'Creature A')}\n${describeCreature(blobB, 'Creature B')}\n\n` +
    `${describeHistory(priorEncounters, Number(affinity) || 0)}\n\n` +
    `${describeScene(scene)}\n\n` +
    'Generate their encounter now.';

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      tools: [ENCOUNTER_TOOL],
      tool_choice: { type: 'tool', name: 'record_encounter' },
    });

    const toolUse = response.content && response.content.find((block) => block.type === 'tool_use');
    const parsed =
      toolUse && Array.isArray(toolUse.input && toolUse.input.lines)
        ? toolUse.input
        : fallbackResponse('They exchanged a few words.');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'AI request failed', detail: err.message }),
    };
  }
};
