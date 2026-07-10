const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.SIM_MODEL || 'claude-haiku-4-5-20251001';
const MAX_FIELD_LEN = 300;

const sanitize = (value) =>
  String(value || '').slice(0, MAX_FIELD_LEN).replace(/[\r\n]+/g, ' ').trim();

const describeCreature = (creature, label) =>
  `${label}: name="${sanitize(creature.name)}", personality="${sanitize(creature.personality)}", ` +
  `role="${sanitize(creature.role)}", faith="${sanitize(creature.faith)}", purpose="${sanitize(creature.purpose)}"`;

const SYSTEM_PROMPT =
  'You are the narrative engine for a 2D life simulation game. Two creatures have just encountered ' +
  'each other in the world. Write a brief, natural in-character exchange between them (2 to 4 short ' +
  "lines total, alternating speakers A and B) consistent with each creature's personality, role, faith, " +
  'and purpose. Then classify the overall outcome of the encounter as exactly one of: "friendly", ' +
  '"neutral", or "hostile". Respond with ONLY compact JSON, no markdown fences, no commentary, matching ' +
  'this shape: {"lines":[{"speaker":"A","text":"..."}],"outcome":"friendly|neutral|hostile","summary":"one short sentence"}';

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

  const { blobA, blobB } = payload;
  if (!blobA || !blobB) {
    return { statusCode: 400, body: JSON.stringify({ error: 'blobA and blobB are required' }) };
  }

  const userMessage =
    `${describeCreature(blobA, 'Creature A')}\n${describeCreature(blobB, 'Creature B')}\n\n` +
    'Generate their encounter now.';

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = response.content && response.content[0];
    const text = block && block.type === 'text' ? block.text : '';

    let parsed;
    try {
      parsed = JSON.parse(text);
      if (!Array.isArray(parsed.lines)) throw new Error('bad shape');
    } catch (err) {
      parsed = fallbackResponse('They exchanged a few words.');
    }

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
