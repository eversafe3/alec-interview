import { Resend } from "resend";

export default async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { candidateName, finalScore, finalRank, scores, answers, hireDate } =
    req.body;

  if (!candidateName || !finalScore || !finalRank) {
    return res
      .status(400)
      .json({ error: "Missing required fields" });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    const scoreBreakdown = [
      "Customer Service & Hospitality",
      "Teamwork & Communication",
      "Food Safety & Quality Standards",
      "Handling Pressure & Work Ethic",
      "Integrity & Accountability",
      "Following Systems & Procedures",
      "Reliability & Growth Mindset",
    ]
      .map(
        (comp, i) =>
          `Q${i + 1}: ${comp} — ${scores[i]?.toFixed(1) || "N/A"}/9`
      )
      .join("\n");

    const emailBody = `
Alec Interview Results

Candidate: ${candidateName}
Date: ${hireDate}

FINAL SCORE: ${finalScore.toFixed(1)}/9
RECOMMENDATION: ${finalRank}

Score Breakdown:
${scoreBreakdown}

See attached PDF for full details including all answers.
`;

    const response = await resend.emails.send({
      from: "Alec Interview <noreply@alec-interview.vercel.app>",
      to: "admin@cfanorthpoint.com",
      subject: `Alec Interview Complete: ${candidateName}`,
      text: emailBody,
    });

    return res.status(200).json({ success: true, messageId: response.id });
  } catch (error) {
    console.error("Email error:", error);
    return res.status(500).json({ error: error.message });
  }
};
