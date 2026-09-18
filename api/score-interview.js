// /api/score-interview.js
// Scores main interview answers 1-9 using the Claude API.
// The API key lives in Vercel env vars (ANTHROPIC_API_KEY) and never reaches the browser.

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { path, role, answers, language } = req.body || {};

    if (!Array.isArray(answers) || answers.length === 0 || (path !== 'yes' && path !== 'no' && path !== 'lead')) {
        return res.status(400).json({ error: 'Missing or invalid fields' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' });
    }

    const count = answers.length;
    const roleLabel = role === 'boh' ? 'Back of House (kitchen / food preparation)'
        : role === 'lead' ? 'Leadership (Team Leader / Manager)'
        : role === 'driver' ? 'Delivery Driver'
        : 'Front of House (counter / drive-thru / dining room)';
    const pathLabel = path === 'lead' ? 'Leadership candidate (experienced)'
        : path === 'yes' ? 'Previous Work Experience'
        : 'First Job / High School Student';
    const langNote = language === 'es'
        ? 'The candidate answered in Spanish. Do not penalize language choice.'
        : 'The candidate answered in English.';

    const allAnswers = answers.map(function(a, i) {
        return 'Q' + (i + 1) + '\nMain answer: ' + a.main + '\nFollow-up answer: ' + a.followUp;
    }).join('\n\n');

    const prompt = 'You are a hiring manager screening candidates for entry-level hourly positions at Chick-fil-A. Score each response 1-9.\n\n'
        + (role === 'lead'
            ? 'IMPORTANT CONTEXT: This is a LEADERSHIP candidate. Hold them to a higher standard than an entry-level applicant. Expect concrete examples of leading people, owning failure, and developing others. Vague or purely theoretical answers should not score above 6.\n\n'
            : 'IMPORTANT CONTEXT: Many candidates are teenagers or first-time job seekers typing on a phone. Score for POTENTIAL and ATTITUDE, not polish. Be generous and give the benefit of the doubt.\n\n')
        + 'Scoring guide:\n'
        + '1-3: C Candidate. Reserve this range for genuinely concerning answers only: blank or nonsense responses, hostility, dishonesty, or clear red flags about work ethic or character. An answer that is merely short or unimpressive is NOT a 1-3.\n'
        + '4-6: B Candidate. The default range. Any reasonable, on-topic answer showing willingness to work, basic teamwork, and a positive attitude belongs here.\n'
        + '7-9: A Candidate. A specific example, evidence of reflection or learning, ownership of a mistake, or genuine enthusiasm for service. One good concrete detail is enough to earn a 7.\n\n'
        + 'Do NOT deduct points for: brief answers, simple vocabulary, spelling or grammar errors, typos, limited work history, or youth. These are expected and are not job-relevant.\n'
        + 'When an answer could reasonably fall into two ranges, choose the HIGHER score.\n\n'
        + 'Position applied for: ' + roleLabel + '\n'
        + 'Candidate Path: ' + pathLabel + '\n'
        + langNote + '\n\n'
        + 'Responses:\n' + allAnswers + '\n\n'
        + 'Return ONLY a JSON array of exactly ' + count + ' integer scores in order. Example: [7,8,6,7]. No other text.';

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
                max_tokens: 300,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Claude API error:', JSON.stringify(data));
            return res.status(502).json({ error: 'Scoring service error', details: data.error ? data.error.message : 'unknown' });
        }

        const text = (data.content || [])
            .filter(function(b) { return b.type === 'text'; })
            .map(function(b) { return b.text; })
            .join('')
            .trim();

        const match = text.match(/\[[\d,\s]+\]/);
        if (!match) {
            console.error('Unexpected model output:', text);
            throw new Error('Unexpected model output format');
        }

        const scores = JSON.parse(match[0]).map(function(s) {
            return Math.min(9, Math.max(1, Math.round(Number(s))));
        });

        return res.status(200).json({ scores: scores });

    } catch (error) {
        console.error('Scoring error:', error.message);
        return res.status(500).json({ error: 'Failed to score interview', details: error.message });
    }
};
