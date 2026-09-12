// /api/score-interview.js
// Scores main interview answers 1-9 using the Claude API.
// The API key lives in Vercel env vars (ANTHROPIC_API_KEY) and never reaches the browser.

const MODEL = process.env.ALEC_MODEL || 'claude-sonnet-5';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { path, answers, language } = req.body || {};

    if (!Array.isArray(answers) || answers.length === 0 || (path !== 'yes' && path !== 'no')) {
        return res.status(400).json({ error: 'Missing or invalid fields' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' });
    }

    const count = answers.length;
    const langNote = language === 'es'
        ? 'The candidate answered in Spanish. Evaluate the answers in Spanish; do not penalize language choice.'
        : 'The candidate answered in English.';

    const prompt = `You are an expert hiring manager for Chick-fil-A. Score the candidate's responses on a scale of 1-9 for each question.

Scoring guide:
1-3: Do Not Hire (significant gaps in competency)
4-6: Consider Employee (meets basic standards, trainable)
7: C Employee (solid, reliable)
8: B Employee (strong, above average)
9: A Employee (exceptional, strong leadership potential)

Evaluate: clarity and thoughtfulness, demonstration of the competency, self-awareness, ability to learn from mistakes, and alignment with Chick-fil-A culture (service, teamwork, integrity, growth). Very short, vague, or off-topic answers should score low.

Candidate Path: ${path === 'yes' ? 'Previous Work Experience' : 'First Job / High School Student'}
${langNote}

Responses:
${answers.map((a, i) => `Q${i + 1}\nMain answer: ${a.main}\nFollow-up answer: ${a.followUp}`).join('\n\n')}

Return ONLY a JSON array of exactly ${count} integer scores, one per question, in order. Example: [7, 8, 6, 7, 8, 6, 7]. No other text.`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: 300,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('Claude API error:', data);
            return res.status(502).json({ error: 'Scoring service error', details: data.error?.message || 'unknown' });
        }

        const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
        const match = text.match(/\[[^\]]*\]/);
        if (!match) throw new Error('No JSON array in model output: ' + text);

        let scores = JSON.parse(match[0]);
        if (!Array.isArray(scores) || scores.length !== count) {
            throw new Error(`Expected ${count} scores, got ${JSON.stringify(scores)}`);
        }
        scores = scores.map(s => {
            const n = Math.round(Number(s));
            if (!Number.isFinite(n)) throw new Error('Non-numeric score: ' + s);
            return Math.min(9, Math.max(1, n));
        });

        return res.status(200).json({ scores, model: MODEL });
    } catch (error) {
        console.error('Scoring error:', error);
        return res.status(500).json({ error: 'Failed to score interview', details: error.message });
    }
}
