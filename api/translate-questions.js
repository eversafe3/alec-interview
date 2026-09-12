export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { questions } = req.body;

    try {
        const prompt = `Translate these interview questions to Spanish. Return ONLY the translations as a JSON array in the exact same order. Do not include explanations.

Questions:
${questions.map((q, i) => `${i}: ${q}`).join('\n')}

Respond ONLY with valid JSON array, nothing else.`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-opus-4-1',
                max_tokens: 2000,
                messages: [{ role: 'user', content: prompt }]
            })
        });
        
        const data = await response.json();
        const translations = JSON.parse(data.content[0].text.trim());

        return res.status(200).json({ translations });
    } catch (error) {
        console.error('Translation error:', error);
        return res.status(500).json({ error: 'Translation failed' });
    }
}
