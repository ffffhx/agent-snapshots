export function sendJson(response, data, status = 200) {
    send(response, status, "application/json; charset=utf-8", JSON.stringify(data, null, 2));
}
export function send(response, status, contentType, body) {
    const headers = {
        "content-type": contentType,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
    };
    if (contentType.startsWith("text/html")) {
        // The local viewer ships its own inline scripts/styles, so those are allowed,
        // but remote images/objects are blocked as a backstop against beacons/SSRF
        // from rendered session content.
        headers["content-security-policy"] =
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";
    }
    response.writeHead(status, headers);
    response.end(body);
}
