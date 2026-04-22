export const config = {
  runtime: "nodejs",
};

export default function handler(_req: any, res: any) {
  res.status(200).json({
    ok: true,
    runtime: "vercel",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
}
