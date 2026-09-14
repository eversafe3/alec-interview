// /api/send-interview-results.js
// Emails interview results to the hiring manager via the Resend REST API.
// No npm packages needed - uses fetch directly, same as score-interview.js.

const RESULTS_EMAIL = 'eversafe@verizon.net';

async function translateList(items, maxTokens) {
    const prompt = 'Translate these Spanish interview answers to English. Return ONLY the translations as a JSON array in the exact same order. Do not include explanations.\n\nAnswers:\n'
        + items.map(function(a, i) { return i + ': ' + a; }).join('\n')
        + '\n\nRespond ONLY with valid JSON array, nothing else.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-5',
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }]
        })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error ? data.error.message : 'translation API error');
    const text = (data.content || [])
        .filter(function(b) { return b.type === 'text'; })
        .map(function(b) { return b.text; })
        .join('')
        .trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in translation output');
    return JSON.parse(match[0]);
}

async function translateAnswers(answers) {
    try {
        const flat = [];
        answers.forEach(function(a) { flat.push(a.main, a.followUp); });
        const translations = await translateList(flat, 2000);
        const out = [];
        let idx = 0;
        answers.forEach(function() {
            out.push({ main: translations[idx++], followUp: translations[idx++] });
        });
        return out;
    } catch (e) {
        console.error('Translation error:', e.message);
        return answers;
    }
}

async function translateBonusAnswers(bonusAnswers) {
    try {
        const toTranslate = bonusAnswers.filter(function(a) {
            return typeof a === 'string' && a !== 'Not provided' && a !== '' && a.charAt(0) !== '{';
        });
        if (toTranslate.length === 0) return bonusAnswers;
        const translations = await translateList(toTranslate, 1000);
        const out = [];
        let idx = 0;
        bonusAnswers.forEach(function(a) {
            if (typeof a === 'string' && a !== 'Not provided' && a !== '' && a.charAt(0) !== '{') {
                out.push(translations[idx++]);
            } else {
                out.push(a);
            }
        });
        return out;
    } catch (e) {
        console.error('Bonus translation error:', e.message);
        return bonusAnswers;
    }
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let { candidateName, finalScore, tier, scores, answers, bonusAnswers, flags, path, language } = req.body || {};

    if (!candidateName || finalScore === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!process.env.RESEND_API_KEY) {
        return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });
    }

    try {
        if (language === 'es') {
            answers = await translateAnswers(answers || []);
            bonusAnswers = await translateBonusAnswers(bonusAnswers || []);
        }

        const pathLabel = path === 'yes' ? 'Work Experience' : 'No Experience';
        const questionsCount = (answers || []).length;

        let emailBody = '<h2>Alec Interview Results</h2>'
            + '<p><strong>Candidate:</strong> ' + candidateName + '</p>'
            + '<p><strong>Path:</strong> ' + pathLabel + '</p>'
            + '<p><strong>Final Score:</strong> <span style="font-size: 24px; color: #d21e1e; font-weight: bold;">' + finalScore.toFixed(1) + '</span> (' + tier + ')</p>'
            + '<hr />';

        if (flags && flags.length > 0) {
            emailBody += '<h3 style="color: #d21e1e;">RED FLAGS - ATTENTION NEEDED</h3>';
            flags.forEach(function(flag) {
                emailBody += '<div style="background: #ffe6e6; padding: 12px; margin-bottom: 12px; border-left: 4px solid #d21e1e;">'
                    + '<strong style="color: #d21e1e;">' + flag.category + ':</strong> ' + flag.text
                    + '</div>';
            });
            emailBody += '<hr />';
        }

        emailBody += '<h3>Question Breakdown (' + questionsCount + ' questions)</h3>'
            + '<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">'
            + '<tr style="background: #f0f0f0;">'
            + '<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Question / Answer</th>'
            + '<th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Score</th>'
            + '</tr>';

        (answers || []).forEach(function(ans, i) {
            const score = (scores && scores[i]) || '-';
            emailBody += '<tr>'
                + '<td style="border: 1px solid #ddd; padding: 8px; font-size: 13px;">'
                + '<strong>Q' + (i + 1) + ' answer:</strong> ' + (ans.main || '')
                + '<br /><strong>Follow-up:</strong> ' + (ans.followUp || '')
                + '</td>'
                + '<td style="border: 1px solid #ddd; padding: 8px; text-align: center; font-weight: 600;">' + score + '/9</td>'
                + '</tr>';
        });

        emailBody += '</table>';

        const bonusQuestions = [
            { q: 'Availability', type: 'availability' },
            { q: 'Transportation', type: 'text' },
            { q: 'Character Reference', type: 'text' },
            { q: 'Strengths & Weaknesses', type: 'text' },
            { q: 'Detail-Oriented vs Visionary', type: 'text' },
            { q: 'Physical Requirements', type: 'text' },
            { q: 'Knows Someone at CFA', type: 'text' },
            { q: 'Attendance & Reliability', type: 'text' }
        ];

        const hasBonus = bonusAnswers && bonusAnswers.length > 0 && bonusAnswers.some(function(a) { return a; });
        if (hasBonus) {
            emailBody += '<h3>Additional Information</h3>';
            bonusQuestions.forEach(function(bq, i) {
                let answer = (bonusAnswers && bonusAnswers[i]) ? bonusAnswers[i] : 'Not provided';
                if (bq.type === 'availability' && answer !== 'Not provided') {
                    try {
                        const avail = JSON.parse(answer);
                        answer = Object.keys(avail).map(function(day) { return day + ': ' + avail[day]; }).join('; ');
                    } catch (e) { /* keep raw answer */ }
                }
                emailBody += '<div style="margin-bottom: 16px;">'
                    + '<strong>' + bq.q + '</strong>'
                    + '<p style="margin: 6px 0 0 0; color: #333; font-size: 13px;">' + answer + '</p>'
                    + '</div>';
            });
        } else {
            emailBody += '<p style="color: #666;"><em>Score below 7 - bonus questions were not shown.</em></p>';
        }

        emailBody += '<hr /><p style="font-size: 12px; color: #666;">Interview completed via Alec AI | North Point Village</p>';

        const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + process.env.RESEND_API_KEY
            },
            body: JSON.stringify({
                from: 'Alec Interview <onboarding@resend.dev>',
                to: [RESULTS_EMAIL],
                subject: 'Alec Interview Complete: ' + candidateName + ' (' + finalScore.toFixed(1) + ' - ' + tier + ')',
                html: emailBody
            })
        });

        const emailResult = await emailResponse.json();

        if (!emailResponse.ok) {
            console.error('Resend API error:', JSON.stringify(emailResult));
            return res.status(502).json({ error: 'Email service error', details: emailResult.message || 'unknown' });
        }

        return res.status(200).json({ success: true, messageId: emailResult.id, candidateName: candidateName, finalScore: finalScore });

    } catch (error) {
        console.error('Error sending email:', error.message);
        return res.status(500).json({ error: 'Failed to send interview results', details: error.message });
    }
};
