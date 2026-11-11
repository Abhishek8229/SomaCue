// Live authentication and proxy verification for the SomaCue auth shell.
// Needs a running server: pnpm dev (port 3100) or SOMACUE_BASE_URL=...
const BASE = process.env.SOMACUE_BASE_URL || "http://localhost:3100";

const jar = new Map();
let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function request(method, path, { body, follow = true } = {}) {
  const headers = {};
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  if (body) headers["content-type"] = "application/json";

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: follow ? "follow" : "manual",
  });

  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  for (const entry of setCookies) {
    const pair = entry.split(";")[0];
    const index = pair.indexOf("=");
    if (index > 0) {
      jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  return {
    status: response.status,
    location: response.headers.get("location"),
    text: await response.text(),
  };
}

async function main() {
  const unique = `test.patient.${Date.now()}@example.com`;

  const register = await request("POST", "/api/auth/register", {
    body: { name: "Test Patient", email: unique, password: "Password123", role: "patient" },
  });
  check("register returns 201", register.status === 201, `status ${register.status}`);
  check("register issues a session cookie", jar.has("somacue_session"));

  const dashboard = await request("GET", "/dashboard");
  check("dashboard reachable while signed in", dashboard.status === 200, `status ${dashboard.status}`);
  check("dashboard renders the user name", dashboard.text.includes("Test Patient"));

  const workspace = await request("GET", "/workspace");
  check("workspace reachable while signed in", workspace.status === 200, `status ${workspace.status}`);

  const authedLogin = await request("GET", "/login", { follow: false });
  check("signed-in /login redirects", authedLogin.status === 307, `status ${authedLogin.status}`);
  check(
    "signed-in /login redirects to /dashboard",
    (authedLogin.location || "").includes("/dashboard"),
    authedLogin.location || "",
  );

  jar.clear();
  const guestDashboard = await request("GET", "/dashboard", { follow: false });
  check("guest /dashboard redirects", guestDashboard.status === 307, `status ${guestDashboard.status}`);
  check(
    "guest /dashboard redirects to /login?from=/dashboard",
    (guestDashboard.location || "").includes("/login?from="),
    guestDashboard.location || "",
  );

  const guestWorkspace = await request("GET", "/workspace", { follow: false });
  check("guest /workspace redirects", guestWorkspace.status === 307, `status ${guestWorkspace.status}`);

  const login = await request("POST", "/api/auth/login", {
    body: { email: unique, password: "Password123" },
  });
  check("registered patient login returns 200", login.status === 200, `status ${login.status}`);
  check("login returns the user payload", login.text.includes(unique));

  const badLogin = await request("POST", "/api/auth/login", {
    body: { email: unique, password: "WrongPassword" },
  });
  check("invalid credentials return 401", badLogin.status === 401, `status ${badLogin.status}`);

  const duplicate = await request("POST", "/api/auth/register", {
    body: { name: "Test Patient", email: unique, password: "Password123", role: "patient" },
  });
  check("duplicate registration returns 409", duplicate.status === 409, `status ${duplicate.status}`);

  const weak = await request("POST", "/api/auth/register", {
    body: { name: "Weak User", email: "weak@example.com", password: "short", role: "patient" },
  });
  check("short password returns 400", weak.status === 400, `status ${weak.status}`);

  const logout = await request("POST", "/api/auth/logout");
  check("logout returns 200", logout.status === 200, `status ${logout.status}`);
  jar.clear();
  const afterLogout = await request("GET", "/dashboard", { follow: false });
  check("dashboard locked after logout", afterLogout.status === 307, `status ${afterLogout.status}`);

  jar.clear();
  const home = await request("GET", "/");
  check("landing page is public", home.status === 200, `status ${home.status}`);
  check(
    "landing page shows the headline",
    home.text.includes("Make the body understandable."),
  );

  const loginPage = await request("GET", "/login");
  check("login page is public", loginPage.status === 200, `status ${loginPage.status}`);

  const registerPage = await request("GET", "/register");
  check("register page is public", registerPage.status === 200, `status ${registerPage.status}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
