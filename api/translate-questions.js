// redeploy trigger
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { questions } = req.body;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    }

    try {
        const prompt = `Translate these interview questions to Spanish. Return ONLY the translations as a JSON array in the exact same order. Do not include explanations.

Questions:
${questions.map((q, i) => `${i}: ${q}`).join('\n')}

Respond ONLY with valid JSON array, nothing else.`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-opus-4-1',
                max_tokens: 2000,
                messages: [{ role: 'user', content: prompt }]
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('Claude API error:', data);
            return res.status(500).json({ error: 'Translation API failed', details: data });
        }

        if (!data.content || !data.content[0]) {
            console.error('Unexpected API response:', data);
            return res.status(500).json({ error: 'Unexpected API response' });
        }

        const translations = JSON.parse(data.content[0].text.trim());

        return res.status(200).json({ translations });
    } catch (error) {
        console.error('Translation error:', error);
        return res.status(500).json({ error: 'Translation failed', details: error.message });
    }
}
