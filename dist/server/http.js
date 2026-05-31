export function sendJson(response, data, status = 200) {
    send(response, status, "application/json; charset=utf-8", JSON.stringify(data, null, 2));
}
export function send(response, status, contentType, body) {
    response.writeHead(status, {
        "content-type": contentType,
        "cache-control": "no-store",
    });
    response.end(body);
}
