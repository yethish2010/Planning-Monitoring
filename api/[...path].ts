export const config = {
  runtime: "nodejs",
};

export default function handler(_req: any, res: any) {
  res.status(404).json({
    error: "This Vercel deployment is running in static frontend mode. Use a deployed backend URL or a dedicated API route.",
  });
}
