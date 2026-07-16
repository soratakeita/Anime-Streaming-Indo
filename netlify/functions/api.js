// netlify/functions/api.js

exports.handler = async function (event, context) {
  // Ambil subpath setelah "/api/"
  const path = event.path.replace(/^\/api\/?/, "");
  
  // Rekonstruksi query parameters jika ada
  const queryParams = new URLSearchParams(event.queryStringParameters).toString();
  const targetUrl = `https://apps.animekita.org/api/v1.2.5/${path}${queryParams ? "?" + queryParams : ""}`;

  console.log(`[Netlify Proxy] Forwarding to: ${targetUrl}`);

  try {
    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: {
        "Referer": "https://apps.animekita.org/",
        "Origin": "https://apps.animekita.org",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Content-Type": event.headers["content-type"] || "application/json"
      },
      body: event.body && event.httpMethod !== "GET" && event.httpMethod !== "HEAD" ? event.body : undefined
    });

    const contentType = response.headers.get("content-type") || "application/json";
    const data = await response.text();

    return {
      statusCode: response.status,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      },
      body: data
    };
  } catch (error) {
    console.error("[Netlify Proxy Error]:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};
