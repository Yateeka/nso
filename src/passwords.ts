import { pbkdf2Sync, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

// Hashes use Werkzeug's "method$salt$hash" format so accounts created by the original Flask app keep working.
const SALT_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SCRYPT = { n: 32768, r: 8, p: 1 };

function scryptHex(password: string, salt: string, n: number, r: number, p: number) {
  return scryptSync(password, salt, 64, { N: n, r, p, maxmem: 132 * n * r * p }).toString("hex");
}

export function hashPassword(password: string) {
  const salt = Array.from({ length: 16 }, () => SALT_CHARS[randomInt(SALT_CHARS.length)]).join("");
  const { n, r, p } = SCRYPT;
  return `scrypt:${n}:${r}:${p}$${salt}$${scryptHex(password, salt, n, r, p)}`;
}

export function verifyPassword(stored: string, password: string) {
  const [method, salt, expected] = String(stored || "").split("$");
  if (!method || salt === undefined || !expected) return false;
  const [kind, ...args] = method.split(":");
  let actual: string;
  try {
    if (kind === "scrypt") {
      const [n, r, p] = args.length ? args.map(Number) : [SCRYPT.n, SCRYPT.r, SCRYPT.p];
      actual = scryptHex(password, salt, n, r, p);
    } else if (kind === "pbkdf2") {
      const digest = args[0] || "sha256";
      const iterations = Number(args[1] || 600000);
      actual = pbkdf2Sync(password, salt, iterations, digest === "sha512" ? 64 : 32, digest).toString("hex");
    } else {
      return false;
    }
  } catch {
    return false;
  }
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
