import { type Lobby } from "./lobby.ts";

export async function getHistory(
  request: Request,
  lobby: Lobby,
  origins: string[],
): Promise<Response> {
  const playerId = new URL(request.url).searchParams.get("playerId");
  if (!playerId) {
    return new Response("Missing playerId", { status: 400 });
  }

  const rows = await lobby.players.findGamesForPlayer(playerId);
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origins.join(","),
    },
  });
}
