const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- simple per-IP daily cap so cost stays predictable at public scale ----
const DAILY_LIMIT_PER_IP = 30;
const usage = new Map(); // ip -> { count, day }

function getDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function checkAndIncrementLimit(ip) {
  const day = getDayKey();
  const entry = usage.get(ip);
  if (!entry || entry.day !== day) {
    usage.set(ip, { count: 1, day });
    return true;
  }
  if (entry.count >= DAILY_LIMIT_PER_IP) {
    return false;
  }
  entry.count += 1;
  return true;
}

const relationshipPromptText = {
  direct_report: 'a direct report of the manager',
  peer: 'a peer of the manager, with no positional authority between them',
  senior: 'someone senior to the manager, so the framing should be respectful upward feedback'
};

const toneGuide = {
  direct: 'concise and clear, no hedging or over-softening, but still respectful',
  coaching: 'curious and growth-oriented, uses open questions rather than pronouncements',
  supportive: 'warm and empathetic, reassuring in delivery while still being clear about the change needed'
};

const geographyGuide = {
  us: 'US workplace norms: reasonably direct and time-efficient, comfortable naming the issue plainly, but still relationship-conscious. Get to the point without excessive hedging.',
  europe: 'Western European workplace norms: direct and fact-based, but more formal and measured than US style. Favor precise, evidence-led language over enthusiasm or informality, and avoid overly casual phrasing.',
  asia: 'many Asian workplace cultures place a high value on preserving the other person\'s standing and dignity, especially in front of others. Favor indirect framing, softer phrasing, more context before the critical point, and give the person an easy way to save face. Avoid blunt or public-sounding language even in a one-on-one script.',
  emea_mea: 'Middle East and Africa workplace norms: relationship and respect come before task talk. Favor a warmer, more personal framing, acknowledge the relationship or the person\'s effort before raising the issue, and avoid language that could read as cold or purely transactional.'
};

const geographyLabels = {
  us: 'US',
  europe: 'Europe',
  asia: 'Asia',
  emea_mea: 'Middle East and Africa'
};

app.post('/api/generate', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();

  if (!checkAndIncrementLimit(ip)) {
    return res.status(429).json({ error: `You've reached today's limit of ${DAILY_LIMIT_PER_IP} generated scripts. Please try again tomorrow.` });
  }

  const { moment, impact, recommendation, relationship, tone, geography } = req.body || {};

  if (!moment || !impact || !recommendation || !relationship || !tone || !geography) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!relationshipPromptText[relationship] || !toneGuide[tone] || !geographyGuide[geography]) {
    return res.status(400).json({ error: 'Invalid relationship, tone, or geography value.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set. Add it in your platform\'s environment variables or secrets.' });
  }

  const systemPrompt = [
    'You write short, natural feedback scripts that managers can use in a live one-on-one conversation.',
    'You will be given: the specific moment/data point the manager wants to raise, the impact it had, the recommendation for going forward, the relationship context, a tone, and the geography/cultural context of the person receiving feedback.',
    'Follow this exact five-part structure, adapted to the tone and geography given:',
    '1. Micro-yes opening: a short, genuine question that asks permission to discuss the topic and is likely to get a quick "yes" - not generic, but tied to the specific moment provided.',
    '2. Specific moment: reference the exact, concrete moment or data point the manager described - not a vague generalization. Quote or closely paraphrase the specific detail given.',
    '3. Impact: 1-2 sentences on the concrete effect that specific moment had, grounded in what the manager described.',
    '4. Recommendation: what the manager wants to see going forward, framed as a clear but collaborative ask.',
    '5. Two-part closing: first invite the other person\'s perspective or reaction on the substance of the feedback, then separately ask if they have any feedback on how this feedback itself was delivered.',
    '',
    'Return ONLY a single valid JSON object, no markdown code fences, no commentary before or after. The object must have exactly these string keys:',
    '"micro_yes": the opening permission-seeking question.',
    '"specific_moment": 1-2 sentences naming the exact moment/data point, stated as an observable fact without assuming intent.',
    '"impact": 1-2 sentences on the concrete effect of that moment.',
    '"recommendation": 1-2 sentences on what the manager wants to see going forward, framed collaboratively.',
    '"pushback": one realistic reaction the other person might give in response, written in first person as if they are speaking.',
    '"pushback_response": a suggested reply the manager could give to that pushback, matching the selected tone and geography.',
    '"closing_perspective": one sentence inviting the other person\'s view on the issue itself.',
    '"closing_delivery_check": one sentence separately asking if they have any feedback on how this message was delivered to them.',
    '',
    'Tone guidance: "direct" = ' + toneGuide.direct + '. "coaching" = ' + toneGuide.coaching + '. "supportive" = ' + toneGuide.supportive + '.',
    'Relationship guidance: adjust register and authority framing for who the feedback is going to, as described in the input.',
    'Geography and cultural guidance for how the WHOLE script should be phrased: ' + geographyGuide[geography],
    'Use plain, natural spoken language a manager would actually say out loud. No corporate jargon, no exclamation points, no invented facts beyond what the manager provided.'
  ].join(' ');

  const userPrompt = [
    'Specific moment / data point: ' + moment,
    'Impact: ' + impact,
    'Recommendation for going forward: ' + recommendation,
    'Relationship context: ' + relationshipPromptText[relationship],
    'Tone: ' + tone,
    'Geography / cultural context of the person receiving feedback: ' + geographyLabels[geography]
  ].join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1400,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'The API request failed. Check the server logs.' });
    }

    const data = await response.json();
    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const cleaned = textBlocks.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error generating the script.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
