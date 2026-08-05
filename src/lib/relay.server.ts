/**
 * Google Apps Script web apps (/exec) answer POST requests with a 302 redirect
 * to script.googleusercontent.com. Per the fetch spec a 302 turns POST into GET
 * and drops the body, so the script sees an empty payload and replies
 * `unauthorized`. This helper follows redirects manually, re-POSTing the body.
 */
export async function postToRelay(url: string, payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  let target = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      target = new URL(location, target).toString();
      continue;
    }
    return res;
  }
  throw new Error("יותר מדי הפניות מהממסר (Apps Script)");
}
