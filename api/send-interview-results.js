import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function translateAnswers(answers, language) {
    if (language === 'en') return answers;
    
    const allAnswers = answers.flatMap(a => [a.main, a.followUp]);
    
    const prompt = `Translate these Spanish interview answers to English. Return ONLY the translations as a JSON array in the exact same order. Do not include explanations.

Answers:
${allAnswers.map((a, i) => `${i}: ${a}`).join('\n')}

Respond ONLY with valid JSON array, nothing else.`;

    try {
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
        
        const translatedAnswers = [];
        let idx = 0;
        answers.forEach(a => {
            translatedAnswers.push({
                main: translations[idx++],
                followUp: translations[idx++]
            });
        });
        
        return translatedAnswers;
    } catch (e) {
        console.error('Translation error:', e);
        return answers;
    }
}

async function translateBonusAnswers(bonusAnswers, bonusQuestionsCount, language) {
    if (language === 'en') return bonusAnswers;
    
    const answersToTranslate = bonusAnswers.filter(a => typeof a === 'string' && a !== 'Not provided' && !a.startsWith('{'));
    if (answersToTranslate.length === 0) return bonusAnswers;
    
    const prompt = `Translate these Spanish interview answers to English. Return ONLY the translations as a JSON array in the exact same order. Do not include explanations.

Answers:
${answersToTranslate.map((a, i) => `${i}: ${a}`).join('\n')}

Respond ONLY with valid JSON array, nothing else.`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-opus-4-1',
                max_tokens: 1000,
                messages: [{ role: 'user', content: prompt }]
            })
        });
        
        const data = await response.json();
        const translations = JSON.parse(data.content[0].text.trim());
        
        const translatedBonus = [];
        let idx = 0;
        bonusAnswers.forEach((a, i) => {
            if (typeof a === 'string' && a !== 'Not provided' && !a.startsWith('{')) {
                translatedBonus.push(translations[idx++]);
            } else {
                translatedBonus.push(a);
            }
        });
        
        return translatedBonus;
    } catch (e) {
        console.error('Bonus translation error:', e);
        return bonusAnswers;
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let { candidateName, finalScore, tier, scores, answers, bonusAnswers, flags, path, language } = req.body;

    if (!candidateName || finalScore === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Translate answers if Spanish
        if (language === 'es') {
            answers = await translateAnswers(answers, language);
            bonusAnswers = await translateBonusAnswers(bonusAnswers, 5, language);
        }

        const pathLabel = path === 'yes' ? 'Work Experience' : 'No Experience';
        const questionsCount = path === 'yes' ? 7 : 6;
        
        // Build email body with red flags at top
        let emailBody = `<h2>Alec Interview Results</h2>
<p><strong>Candidate:</strong> ${candidateName}</p>
<p><strong>Path:</strong> ${pathLabel}</p>
<p><strong>Final Score:</strong> <span style="font-size: 24px; color: #d21e1e; font-weight: bold;">${finalScore.toFixed(1)}</span> (${tier})</p>
<hr />`;

        // Red flags section at top
        if (flags && flags.length > 0) {
            emailBody += `<h3 style="color: #d21e1e;">⚠️ RED FLAGS - ATTENTION NEEDED</h3>`;
            flags.forEach(flag => {
                emailBody += `<div style="background: #ffe6e6; padding: 12px; margin-bottom: 12px; border-left: 4px solid #d21e1e; border-radius: 2px;">
    <strong style="color: #d21e1e;">${flag.category}:</strong> ${flag.text}
</div>`;
            });
            emailBody += `<hr />`;
        }

        // Question scores
        emailBody += `<h3>Question Breakdown (${questionsCount} questions)</h3>
<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
<tr style="background: #f0f0f0;">
    <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Question</th>
    <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Score</th>
</tr>`;
        
        answers.forEach((ans, i) => {
            const qNum = i + 1;
            const score = scores[i] || '—';
            emailBody += `<tr>
    <td style="border: 1px solid #ddd; padding: 8px; font-size: 13px;">Q${qNum}: ${ans.main.substring(0, 60)}...</td>
    <td style="border: 1px solid #ddd; padding: 8px; text-align: center; font-weight: 600;">${score}/9</td>
</tr>`;
        });
        
        emailBody += `</table>`;

        // Bonus answers with inline flag markers
        emailBody += `<h3>Additional Information</h3>`;
        
        const bonusQuestions = [
            { q: 'Availability (next 6 months)', type: 'availability' },
            { q: 'Transportation', type: 'text' },
            { q: 'Character Reference', type: 'text' },
            { q: 'Strengths & Weaknesses', type: 'text' },
            { q: 'Detail-Oriented vs Visionary', type: 'text' }
        ];

        bonusQuestions.forEach((bq, i) => {
            let answer = bonusAnswers && bonusAnswers[i] ? bonusAnswers[i] : 'Not provided';
            
            // Parse availability if type is availability
            if (bq.type === 'availability' && answer !== 'Not provided') {
                try {
                    const avail = JSON.parse(answer);
                    answer = Object.entries(avail).map(([day, time]) => `${day}: ${time}`).join('; ');
                } catch (e) {
                    // If parse fails, just use raw answer
                }
            }

            // Check if this answer has a flag
            const hasFlag = flags && flags.some(f => {
                const flagText = f.text.toLowerCase();
                const answerText = answer.toLowerCase();
                return answerText.includes(flagText) || flagText.includes(answerText);
            });

            const flagMarker = hasFlag ? '<span style="color: #d21e1e; font-weight: bold; margin-left: 8px;">⚠️ FLAGGED</span>' : '';
            
            emailBody += `<div style="margin-bottom: 16px;">
    <strong>${bq.q}${flagMarker}</strong>
    <p style="margin: 6px 0 0 0; color: #333; font-size: 13px;">${answer}</p>
</div>`;
        });

        emailBody += `<hr />
<p style="font-size: 12px; color: #666;">Interview completed via Alec AI | North Point Village</p>`;

        const message = {
            from: 'noreply@cfanorthpoint.com',
            to: 'admin@cfanorthpoint.com',
            subject: `Alec Interview Complete: ${candidateName} (${finalScore.toFixed(1)} - ${tier})`,
            html: emailBody
        };

        const emailResult = await resend.emails.send(message);

        return res.status(200).json({
            success: true,
            messageId: emailResult.id,
            candidateName,
            finalScore
        });

    } catch (error) {
        console.error('Error sending email:', error);
        return res.status(500).json({
            error: 'Failed to send interview results',
            details: error.message
        });
    }
}
