export const config = {
  runtime: "nodejs",
};

export default async function handler(_req: any, res: any) {
  try {
    await import("./_server.bundle.js");
    return res.status(200).json({ ok: true, backendLoaded: true });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      backendLoaded: false,
      errorName: error?.name || "Error",
      errorCode: error?.code || "",
      errorMessage: error?.message || "Backend failed to load.",
    });
  }
}
