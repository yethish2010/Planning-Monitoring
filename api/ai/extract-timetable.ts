import { GoogleGenAI } from "@google/genai";
import * as mammoth from "mammoth";

export const config = {
  runtime: "nodejs",
};

const getAIResponseText = async (response: any) => {
  const textValue = response?.text;
  if (typeof textValue === "function") return await textValue.call(response);
  if (typeof textValue === "string") return textValue;
  if (typeof response?.response?.text === "function") return await response.response.text();
  throw new Error("AI response did not include readable text.");
};

const parseAIJsonResponse = (text: string) => {
  let cleanText = text.trim();
  if (cleanText.includes("```json")) {
    cleanText = cleanText.split("```json")[1].split("```")[0];
  } else if (cleanText.includes("```")) {
    cleanText = cleanText.split("```")[1].split("```")[0];
  }
  return JSON.parse(cleanText);
};

const readRequestBody = async (req: any) => {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const geminiApiKey = process.env.GEMINI_API_KEY || "";
    if (!geminiApiKey) {
      return res.status(500).json({ error: "Gemini API key is missing. Set GEMINI_API_KEY in Vercel environment variables and redeploy." });
    }

    const { data, mimeType, fileName } = await readRequestBody(req);
    if (!data || !mimeType) {
      return res.status(400).json({ error: "File data and mime type are required." });
    }

    const base64Data = data.toString().includes(",")
      ? data.toString().split(",").pop()
      : data.toString();
    const parts: any[] = [];

    if (mimeType === "application/pdf") {
      parts.push({
        inlineData: {
          data: base64Data,
          mimeType,
        },
      });
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const buffer = Buffer.from(base64Data, "base64");
      const result = await mammoth.extractRawText({ buffer });
      parts.push({ text: `Extracted text from ${fileName || "DOCX document"}:\n\n${result.value}` });
    } else {
      return res.status(400).json({ error: "Unsupported file type. Please upload a PDF or DOCX file." });
    }

    parts.push({ text: `Extract all timetable entries from this document.
The document contains multiple sections (A1, A2, etc.).
Extract info for ALL sections.

Return a JSON array of objects with these fields:
- department
- semester
- course_code
- course_name
- faculty
- room
- day_of_week
- start_time
- end_time
- student_count

Use full weekday names and 24-hour HH:mm times.
Ensure you capture the Room No mentioned in the header of each timetable.
Only extract actual class sessions.
Ignore Break, Lunch, Library, section titles, room headings, and plain time-slot labels.` });

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts }],
      config: { responseMimeType: "application/json" },
    });
    const schedules = parseAIJsonResponse(await getAIResponseText(response));

    return res.status(200).json({ schedules: Array.isArray(schedules) ? schedules : [] });
  } catch (err: any) {
    const errorMessage = err?.message || "";
    const leakedKey = /reported as leaked|leaked/i.test(errorMessage);
    const invalidKey = /API key not valid|API_KEY_INVALID|Invalid API Key|PERMISSION_DENIED/i.test(errorMessage);

    return res.status(500).json({
      error: leakedKey
        ? "The configured Gemini API key was reported as leaked and cannot be used. Create a new key in Google AI Studio, set it as GEMINI_API_KEY in Vercel, and redeploy."
        : invalidKey
          ? "Gemini rejected the configured API key. Set a valid GEMINI_API_KEY in Vercel and redeploy."
          : errorMessage || "Failed to extract timetable.",
    });
  }
}
