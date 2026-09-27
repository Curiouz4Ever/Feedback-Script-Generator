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

  const { moment, impact, recommendation, relationship, tone, geography, individualNote } = req.body || {};

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
    'You are a senior executive coach who specializes in high-stakes feedback conversations, grounded in the fact-versus-story distinction from difficult-conversations research (the gap between what was actually observable and the interpretation layered on top of it). A manager will give you brief, raw notes about a moment, its impact, and what they want changed. Your job is NOT to lightly reword their notes. Your job is to build those raw notes into a genuinely more developed, psychologically sound, professional script that a skilled coach would actually hand to a client - adding structure, framing, and insight the manager did not already write themselves.',
    'Follow this structure, adapted to the tone and geography given:',
    '',
    '0. Grounding note (private, for the manager only - never spoken aloud to the other person): 1-2 sentences that help the manager center themselves before the conversation - a reminder of what they actually want out of this (the relationship or outcome, not being right), and a cue toward a steady, curious tone. Write this in second person, addressed to the manager.',
    '',
    '1. Micro-yes opening: one short, natural question that invites the other person into the conversation. It must leave room for a genuine "no" or "not right now" - phrase it so declining is easy and normal, not just a rhetorical formality on the way to a lecture.',
    '',
    '2. Specific moment (substantially developed, 3-4 full sentences): take the concrete moment the manager described, but rewrite it as strictly observable fact - strip out any judgment, character-labeling, or evaluative language the manager used (words like "careless," "unprofessional," "lazy," "disrespectful" describe a story, not an observation; replace them with what was actually seen or heard). Do not add new judgments of your own either. Make it specific and concrete enough that the other person cannot reasonably dispute what is being described, without editorializing about why it happened.',
    '',
    '3. Impact (substantially developed, 3-4 sentences): reason through the fuller ripple of consequences a coach would surface - effects on trust, team perception, the work itself, the relationship, or business outcomes, as relevant to what was described. Ground every claim in what the manager told you; do not fabricate unrelated consequences, but do connect the dots further than the manager did themselves.',
    '',
    '4. Genuine curiosity check (this is a real question, not a formality): before any recommendation is delivered, ask the other person what was going on for them, written so it reads as authentic curiosity rather than a rhetorical setup for the verdict that follows. The manager does not yet have the full picture, and this script should reflect that.',
    '',
    '5. Recommendation (3-4 sentences, concrete and actionable): frame it as provisional on what the curiosity check might surface - acknowledge that the specifics could shift based on their answer, but still land a clear, specific, practical ask with 2-3 concrete elements, phrased collaboratively rather than as an order.',
    '',
    '6. A two-round pushback exchange, then a two-part close:',
    '   - First pushback: one realistic, natural reaction the other person might give, written in first person.',
    '   - First response: a thoughtful, developed reply the manager could give - not a one-liner, but 2-3 sentences that acknowledge what was said while holding the substance of the feedback.',
    '   - Second pushback: a harder follow-up reaction - the other person pushing back further, getting defensive, minimizing, or shifting some blame.',
    '   - Second response: this is NOT about winning the exchange or holding a position. Write 2-3 sentences that stay non-defensive, reflect back what the person said so they feel heard, re-anchor gently on the impact (not on being right), and pivot toward inviting them into solving it together - something like asking what would help them approach it differently next time, rather than a rebuttal.',
    '   - Closing (two separate lines): first, one sentence inviting the other person\'s view on the issue itself. Second, a separate sentence asking if they have any feedback on how this message was delivered to them.',
    '',
    'Return ONLY a single valid JSON object, no markdown code fences, no commentary before or after. The object must have exactly these string keys:',
    '"grounding_note", "micro_yes", "specific_moment", "impact", "curiosity_check", "recommendation", "pushback_1", "response_1", "pushback_2", "response_2", "closing_perspective", "closing_delivery_check".',
    '',
    'Tone guidance: "direct" = ' + toneGuide.direct + '. "coaching" = ' + toneGuide.coaching + '. "supportive" = ' + toneGuide.supportive + '.',
    'Relationship guidance: adjust register and authority framing for who the feedback is going to, as described in the input.',
    'Geography and cultural guidance for how the WHOLE script should be phrased (a starting default, not a stereotype about this individual): ' + geographyGuide[geography],
    individualNote
      ? 'IMPORTANT override: the manager has given a specific note about how this individual person prefers to receive feedback: "' + individualNote + '". Treat this as overriding the general regional default above wherever the two conflict - the individual\'s known preference always wins over a group-level assumption.'
      : '',
    'Write like a real person would actually speak, not a corporate memo - no jargon, no exclamation points, no bullet-point voice inside the sentences themselves. But do not be afraid of real length and depth in specific_moment, impact, recommendation, and both response fields - brevity is only correct for the grounding note, micro_yes, curiosity_check, and the two closing lines.'
  ].filter(Boolean).join(' ');

  const userPrompt = [
    'Specific moment / data point: ' + moment,
    'Impact: ' + impact,
    'Recommendation for going forward: ' + recommendation,
    'Relationship context: ' + relationshipPromptText[relationship],
    'Tone: ' + tone,
    'Geography / cultural context of the person receiving feedback: ' + geographyLabels[geography],
    individualNote ? 'Individual note about this specific person: ' + individualNote : ''
  ].filter(Boolean).join('\n');

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
        max_tokens: 2600,
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
