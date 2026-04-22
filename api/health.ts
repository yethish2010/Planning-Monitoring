export const config = {
  runtime: "nodejs",
};

const checkDatabaseConnection = async () => {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    return {
      databaseConfigured: false,
      databaseConnected: false,
      databaseProvider: process.env.DATABASE_PROVIDER || "",
    };
  }

  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  });

  try {
    await pool.query("SELECT 1");
    return {
      databaseConfigured: true,
      databaseConnected: true,
      databaseProvider: "postgres",
    };
  } catch (error: any) {
    return {
      databaseConfigured: true,
      databaseConnected: false,
      databaseProvider: "postgres",
      databaseError: error?.code || error?.message || "Connection failed",
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
};

export default async function handler(_req: any, res: any) {
  const databaseStatus = await checkDatabaseConnection();

  res.status(200).json({
    ok: true,
    runtime: "vercel",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    ...databaseStatus,
    timestamp: new Date().toISOString(),
  });
}
