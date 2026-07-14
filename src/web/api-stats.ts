import {
  getUsageSummary,
  getDailyUsage,
  getProviderBreakdown,
  getModelBreakdown,
} from "../db/stats-queries";

export async function handleStatsSummary(path: string): Promise<Response> {
  const url = new URL(path, "http://localhost");
  const days = parseInt(url.searchParams.get("days") || "7");
  const data = getUsageSummary(days);
  return Response.json(data);
}

export async function handleStatsDaily(path: string): Promise<Response> {
  const url = new URL(path, "http://localhost");
  const days = parseInt(url.searchParams.get("days") || "7");
  const data = getDailyUsage(days);
  return Response.json(data);
}

export async function handleStatsProvider(path: string): Promise<Response> {
  const url = new URL(path, "http://localhost");
  const days = parseInt(url.searchParams.get("days") || "7");
  const data = getProviderBreakdown(days);
  return Response.json(data);
}

export async function handleStatsModel(path: string): Promise<Response> {
  const url = new URL(path, "http://localhost");
  const days = parseInt(url.searchParams.get("days") || "7");
  const data = getModelBreakdown(days);
  return Response.json(data);
}
