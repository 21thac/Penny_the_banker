// Talks to an AI service (Claude, GPT or DeepSeek) to turn a sentence or a
// screenshot into draft entries, and to write the monthly review.
//
// The API key is the user's own and is kept in this browser only, in its own
// storage slot, so it is never part of the data that gets synced or exported.

import { getState, categoriesOf } from './store.js';
import { todayStr, parseDate } from './util.js';

const AI_KEY = 'ledger.ai';

// The AI services Penny can use. Each needs the user's own key for that service.
export const PROVIDERS = {
  anthropic: {
    name: 'Claude',
    company: 'Anthropic',
    keyHint: 'sk-ant-…',
    site: 'console.anthropic.com',
    vision: true,
    defaultModel: 'claude-opus-5-5',
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most accurate)' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
    ],
  },
  openai: {
    name: 'GPT',
    company: 'OpenAI',
    keyHint: 'sk-…',
    site: 'platform.openai.com',
    base: 'https://api.openai.com/v1',
    vision: true,
    defaultModel: 'gpt-4o-mini',
  },
  deepseek: {
    name: 'DeepSeek',
    company: 'DeepSeek',
    keyHint: 'sk-…',
    site: 'platform.deepseek.com',
    base: 'https://api.deepseek.com',
    vision: false, // text only: it cannot read screenshots
    defaultModel: 'deepseek-chat',
  },
};

// Stored shape: { provider, keys: { anthropic, openai, deepseek }, models: {…}, lists: {…} }
export function getAI() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(AI_KEY) || '{}');
  } catch {
    /* start fresh */
  }
  const ai = { provider: 'anthropic', keys: {}, models: {}, lists: {}, ...saved };
  // Saves from before other services were added held a single Claude key.
  if (saved.key && !ai.keys.anthropic) ai.keys.anthropic = saved.key;
  if (saved.model && !ai.models.anthropic) ai.models.anthropic = saved.model;
  delete ai.key;
  delete ai.model;
  if (!PROVIDERS[ai.provider]) ai.provider = 'anthropic';
  return ai;
}

function saveAI(ai) {
  try {
    localStorage.setItem(AI_KEY, JSON.stringify(ai));
  } catch {
    /* storage unavailable */
  }
}

export const setProvider = (provider) => saveAI({ ...getAI(), provider });

export function setKey(provider, key) {
  const ai = getAI();
  ai.keys[provider] = key;
  saveAI(ai);
}

export function setModel(provider, model) {
  const ai = getAI();
  ai.models[provider] = model;
  saveAI(ai);
}

// The service in use, with its key and chosen model.
export function currentAI() {
  const ai = getAI();
  const info = PROVIDERS[ai.provider];
  return {
    provider: ai.provider,
    info,
    key: ai.keys[ai.provider] || '',
    model: ai.models[ai.provider] || info.defaultModel,
    list: info.models || (ai.lists[ai.provider] || []).map((id) => ({ id, label: id })),
  };
}

export const hasKey = () => !!currentAI().key;

// Ask the service which models this key can use, so the picker shows real,
// current names instead of a list that goes out of date.
export async function loadModels(provider) {
  const info = PROVIDERS[provider];
  const ai = getAI();
  if (!info.base || !ai.keys[provider]) return [];
  const res = await timedFetch(`${info.base}/models`, { headers: { authorization: `Bearer ${ai.keys[provider]}` } }, 20);
  if (!res.ok) throw new AIError(res.status === 401 ? "That API key wasn't accepted." : `Couldn't load the model list (${res.status}).`);
  const skip = /embed|whisper|tts|audio|dall|image|moderation|realtime|transcri|search|instruct|babbage|davinci|sora|codex/i;
  const ids = ((await res.json()).data || [])
    .map((m) => m.id)
    .filter((id) => !skip.test(id))
    .sort();
  ai.lists[provider] = ids;
  if (ids.length && !ids.includes(ai.models[provider] || info.defaultModel)) ai.models[provider] = ids[0];
  saveAI(ai);
  return ids;
}

export class AIError extends Error {}

// fetch with a time limit, so a stalled service cannot leave Penny waiting forever.
async function timedFetch(url, options, seconds = 90) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), seconds * 1000);
  try {
    return await fetch(url, { ...options, signal: ctl.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new AIError('That took too long, so I stopped waiting. Try again, or pick a faster model in Settings.');
    }
    throw new AIError("I couldn't reach the internet. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

function systemPrompt() {
  const today = todayStr();
  const weekday = parseDate(today).toLocaleDateString('en', { weekday: 'long' });
  const list = (type) =>
    categoriesOf(type)
      .map((c) => `- ${c.id}: ${c.name}`)
      .join('\n');

  return `You are Penny, the friendly helper inside a personal money diary app. The user tells you what they spent or received, in a typed or dictated sentence or in a screenshot (a receipt, a bank or e-wallet transaction list, a payment confirmation, an order page). Your job is to turn that into draft diary entries, which the user reviews before anything is saved.

Today is ${weekday}, ${today}. The user's currency is ${getState().settings.currency}.

Spending categories (id: name):
${list('expense')}

Income categories (id: name):
${list('income')}

How to write the entries:
- One entry per separate transaction. A receipt with several items from one shop is one entry for the total paid, unless the user asks for it to be split.
- "amount" is a positive number without a currency symbol. Money going out is type "expense"; money coming in (salary extras, refunds, transfers received, gifts) is type "income".
- "category_id" must be one of the ids above that matches the type. Choose the closest fit; the user can change it during review.
- "date" is YYYY-MM-DD. Work out relative dates ("yesterday", "last Friday") from today's date. When no date is given or visible, use today. When a screenshot shows a day and month without a year, pick the most recent such date that is not in the future.
- "note" is a few words naming the merchant or what it was for, in the language the user used. Leave it empty when there is nothing useful to add.
- In transaction lists, skip rows that are not real spending or income for the user: balances, running totals, failed or reversed payments, and transfers between the user's own accounts.
- If an amount is in a currency other than the user's, keep the number as shown and say which currency in the note.
- Dictated text can contain recognition mistakes; go with the most sensible reading.

"reply" is one short, warm sentence to the user, said as Penny, in the language they wrote their message in. Use English when the message is in English, and for screenshots sent without a message; the currency is not a clue to their language. In it, confirm what you found, or, when you could not find any amount, say what you still need. Never invent a transaction that is not in the input; an empty "entries" list is the right answer when there is nothing to record.`;
}

function schema() {
  const ids = getState()
    .categories.filter((c) => !c.archived)
    .map((c) => c.id);
  return {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['expense', 'income'] },
            amount: { type: 'number' },
            category_id: { type: 'string', enum: ids },
            date: { type: 'string', format: 'date' },
            note: { type: 'string' },
          },
          required: ['type', 'amount', 'category_id', 'date', 'note'],
          additionalProperties: false,
        },
      },
    },
    required: ['reply', 'entries'],
    additionalProperties: false,
  };
}

// Make sure whatever comes back is safe to put in front of the user.
function clean(raw) {
  const today = todayStr();
  return (Array.isArray(raw) ? raw : [])
    .map((e) => {
      const type = e.type === 'income' ? 'income' : 'expense';
      const cats = categoriesOf(type);
      const amount = Math.round(Math.abs(Number(e.amount)) * 100) / 100;
      return {
        type,
        amount,
        categoryId: cats.some((c) => c.id === e.category_id) ? e.category_id : cats[0]?.id,
        date: /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? e.date : today,
        note: String(e.note || '').slice(0, 80),
      };
    })
    .filter((e) => e.amount > 0 && e.categoryId);
}

// One request that must come back as JSON matching `schema`, sent to whichever
// service is selected in Settings.
async function callModel(req) {
  const { provider, info, key, model } = currentAI();
  if (!key) throw new AIError('No API key yet.');
  return provider === 'anthropic'
    ? callAnthropic({ ...req, key, model })
    : callOpenAIStyle({ ...req, key, model, info });
}

function httpError(status, detail, name) {
  if (status === 401) return new AIError("That API key wasn't accepted. Check it in Settings.");
  if (status === 402) return new AIError('That key is out of credit. Top it up and try again.');
  if (status === 403) return new AIError(`This key isn't allowed to do that. ${detail}`);
  if (status === 404) return new AIError(`That model isn't available to this key. Pick another in Settings. ${detail}`);
  if (status === 429) return new AIError("I'm being asked too fast, or the key is out of credit. Try again in a moment.");
  if (status >= 500) return new AIError(`${name} is busy right now. Try again in a moment.`);
  return new AIError(`Something went wrong (${status}). ${detail}`);
}

// GPT and DeepSeek share the same chat format. They are asked for a JSON
// object, with the exact shape spelled out in the instructions.
async function callOpenAIStyle({ system, content, schema, key, model, info }) {
  const hasImage = content.some((b) => b.type === 'image');
  if (hasImage && !info.vision) {
    throw new AIError(`${info.name} can't read pictures. Type or say it, or switch to GPT or Claude in Settings.`);
  }
  const user = info.vision
    ? content.map((b) =>
        b.type === 'image'
          ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
          : { type: 'text', text: b.text },
      )
    : content.map((b) => b.text).join('\n');

  const res = await timedFetch(`${info.base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${system}\n\nReply with one JSON object and nothing else. It must match this JSON Schema exactly:\n${JSON.stringify(schema)}`,
          },
          { role: 'user', content: user },
        ],
      }),
    });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch {
      /* no body */
    }
    throw httpError(res.status, detail, info.name);
  }
  const msg = await res.json();
  const text = msg.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new AIError("I got a reply I couldn't read. Please try again.");
  }
}

// The Claude API, which can be held to the schema directly.
async function callAnthropic({ system, content, schema, effort = 'low', key, model }) {

  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2026-10-21',
    // Required for calling the API straight from a browser with the user's own key.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
  // If Opus declines a request, let the API retry it on a fallback model.
  if (model === 'claude-opus-5-5') {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }

  const res = await timedFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch {
      /* no body */
    }
    throw httpError(res.status, detail, 'Claude');
  }

  const msg = await res.json();
  if (msg.stop_reason === 'refusal') throw new AIError("I can't help with that one.");
  if (msg.stop_reason === 'max_tokens') throw new AIError('That was too much for one go. Try again with less.');

  const block = (msg.content || []).find((b) => b.type === 'text');
  try {
    return JSON.parse(block?.text ?? '');
  } catch {
    throw new AIError("I got a reply I couldn't read. Please try again.");
  }
}

// text: what the user typed or said. image: { mediaType, data } with base64 data.
export async function askPenny({ text, image }) {
  const content = [];
  if (image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data },
    });
  }
  content.push({
    type: 'text',
    text: text || 'Please record the transactions shown in this screenshot.',
  });
  const data = await callModel({ system: systemPrompt(), content, schema: schema() });
  return { reply: String(data.reply || ''), entries: clean(data.entries) };
}

// ---- Monthly review ----

const REVIEW_SYSTEM = `You are Penny, the helper inside a personal money diary app. The user has asked you to review one month of their own spending. The figures arrive as JSON: their income and the needs / wants / savings plan they chose, every spending category with what was spent this month, its current limit and what it usually costs per month, the largest individual entries, and last month's totals. All amounts are in the currency named in the data.

They are reading on a phone and want two things from you: which areas they are spending too much on, and what monthly limit to set for each category. Be specific and use their own numbers. Write plainly and kindly, as a friend who is good with money would: no lecturing, no generic tips that could apply to anyone.

How to judge the month:
- When "month_in_progress" is true the month is not over, so judge the pace. Compare what has been spent with how far through the month it is ("day_of_month" of "days_in_month") rather than treating a part-month total as final.
- "Needs" are essentials and "wants" are choices. Overspending on wants matters more than a need that simply costs what it costs. Fixed costs such as rent are not overspending just because they are large.
- A category is worth flagging when it is over its limit, well above what it usually costs, or taking a share that pushes its group past the plan.
- When "monthly_salary" is 0 no plan has been set. Work from usual spending instead, and mention once that setting a salary on the Budget tab will make the advice sharper.

What to return:
- "headline": one sentence giving the overall verdict for the month.
- "observations": two to four short sentences, each a single concrete finding with its figure and what it is being compared with.
- "overspending": the categories where spending is clearly too high, most serious first. For each, "note" says by how much and gives one practical way to bring it down that fits what the entries show. Leave the list empty when nothing stands out; do not invent a problem.
- "recommended_limits": one entry for every category in the data, with a monthly "limit" and a "reason" of a few words. Base each limit on what the category usually costs, keep fixed costs at their real amount, and trim where they are overspending. When a plan exists, the needs limits together should not exceed the needs amount, and the wants limits together should not exceed the wants amount. Use tidy round numbers.
- "closing": one short encouraging sentence.

Write in English unless the category names and notes are clearly in another language, in which case use that language.`;

function reviewSchema(ids) {
  const str = { type: 'string' };
  return {
    type: 'object',
    properties: {
      headline: str,
      observations: { type: 'array', items: str },
      overspending: {
        type: 'array',
        items: {
          type: 'object',
          properties: { category_id: { type: 'string', enum: ids }, note: str },
          required: ['category_id', 'note'],
          additionalProperties: false,
        },
      },
      recommended_limits: {
        type: 'array',
        items: {
          type: 'object',
          properties: { category_id: { type: 'string', enum: ids }, limit: { type: 'number' }, reason: str },
          required: ['category_id', 'limit', 'reason'],
          additionalProperties: false,
        },
      },
      closing: str,
    },
    required: ['headline', 'observations', 'overspending', 'recommended_limits', 'closing'],
    additionalProperties: false,
  };
}

// data: the month's figures from insights.reviewData().
export async function askReview(data) {
  const ids = data.categories.map((c) => c.id);
  if (!ids.length) throw new AIError('There is no spending to review yet.');
  const raw = await callModel({
    system: REVIEW_SYSTEM,
    content: [{ type: 'text', text: JSON.stringify(data) }],
    schema: reviewSchema(ids),
    effort: 'medium',
  });
  const known = (x) => ids.includes(x.category_id);
  const seen = new Set();
  return {
    headline: String(raw.headline || ''),
    observations: (raw.observations || []).map(String).filter(Boolean).slice(0, 4),
    overspending: (raw.overspending || []).filter(known).map((o) => ({ categoryId: o.category_id, note: String(o.note || '') })),
    limits: (raw.recommended_limits || [])
      .filter((l) => known(l) && Number(l.limit) > 0 && !seen.has(l.category_id) && seen.add(l.category_id))
      .map((l) => ({ categoryId: l.category_id, limit: Math.round(Number(l.limit) * 100) / 100, reason: String(l.reason || '') })),
    closing: String(raw.closing || ''),
  };
}

// Reviews are kept on this device, one per month, so they stay on screen
// without asking again.
const REVIEW_KEY = 'ledger.reviews';

export function savedReview(month) {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}')[month] || null;
  } catch {
    return null;
  }
}

export function saveReview(month, review) {
  try {
    const all = JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}');
    all[month] = { at: Date.now(), review };
    localStorage.setItem(REVIEW_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

// Shrink a picked image so screenshots upload quickly and cost less to read.
export function prepareImage(file, maxEdge = 1568) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ mediaType: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AIError("I couldn't open that image."));
    };
    img.src = url;
  });
}
