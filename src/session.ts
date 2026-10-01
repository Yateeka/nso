import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { appSettings } from "../db/schema.js";

export const SESSION_HOURS = 8;
const COOKIE = "inventory_session";

export type Flash = [category: string, message: string];
export interface SessionData {
  username?: string;
  csrf?: string;
  flashes?: Flash[];
  permanent?: boolean;
  expires?: number;
}

let cachedSecret: string | null = null;

// Prefer SECRET_KEY from the environment; otherwise generate one once and keep it in the database.
async function getSecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.SECRET_KEY && process.env.SECRET_KEY.length >= 16) return (cachedSecret = process.env.SECRET_KEY);
  await db.insert(appSettings).values({ key: "session_secret", value: randomBytes(32).toString("hex") }).onConflictDoNothing();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "session_secret"));
  return (cachedSecret = row.value);
}

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export class Session {
  data: SessionData;
  private original: string;

  private constructor(data: SessionData) {
    this.data = data;
    this.original = JSON.stringify(data);
  }

  static async load(req: Request) {
    const raw = readCookie(req, COOKIE);
    if (raw) {
      const [payload, signature] = raw.split(".");
      const secret = await getSecret();
      const expected = Buffer.from(sign(payload || "", secret));
      const given = Buffer.from(signature || "");
      if (payload && expected.length === given.length && timingSafeEqual(expected, given)) {
        try {
          const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionData;
          if (!data.expires || data.expires > Date.now()) return new Session(data);
        } catch { /* fall through to an empty session */ }
      }
      return Object.assign(new Session({}), { original: "invalid" });
    }
    return new Session({});
  }

  csrfToken() {
    if (!this.data.csrf) this.data.csrf = randomBytes(32).toString("base64url");
    return this.data.csrf;
  }

  flash(message: string, category = "info") {
    (this.data.flashes ||= []).push([category, message]);
  }

  takeFlashes() {
    const flashes = this.data.flashes || [];
    delete this.data.flashes;
    return flashes;
  }

  clear() {
    this.data = {};
  }

  async apply(response: Response, req: Request) {
    const current = JSON.stringify(this.data);
    if (current === this.original) return response;
    const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
    let cookie: string;
    if (!Object.keys(this.data).length) {
      cookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
    } else {
      this.data.expires ||= Date.now() + SESSION_HOURS * 3600 * 1000;
      const payload = Buffer.from(JSON.stringify(this.data)).toString("base64url");
      const maxAge = this.data.permanent ? `; Max-Age=${SESSION_HOURS * 3600}` : "";
      cookie = `${COOKIE}=${payload}.${sign(payload, await getSecret())}; Path=/; HttpOnly; SameSite=Lax${maxAge}${secure}`;
    }
    response.headers.append("Set-Cookie", cookie);
    return response;
  }
}
