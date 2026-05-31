import type { ServerResponse } from "node:http";

export function sendJson(response: ServerResponse, data: unknown, status = 200): void {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(data, null, 2));
}

export function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}
