/**
 * Google Apps Script web apps (/exec) answer POST requests with a 302 redirect
 * to script.googleusercontent.com, where the actual JSON result is served.
 * That follow-up hop must be a GET — re-POSTing there returns 405. We follow
 * redirects manually: POST the body to /exec, then GET each redirect target.
 */
export async function postToRelay(url: string, payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  let target = url;
  let method: "POST" | "GET" = "POST";
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(target, {
      method,
      ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body } : {}),
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      target = new URL(location, target).toString();
      method = "GET";
      continue;
    }
    return res;
  }
  throw new Error("יותר מדי הפניות מהממסר (Apps Script)");
}

