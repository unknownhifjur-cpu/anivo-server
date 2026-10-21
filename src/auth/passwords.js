import { randomBytes, scrypt as callbackScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(callbackScrypt);
const cost = 16384;
const blockSize = 8;
const parallelization = 1;
const keyLength = 64;
const maxMemory = 64 * 1024 * 1024;

export function isValidPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 12 &&
    Buffer.byteLength(password, "utf8") <= 72
  );
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, keyLength, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: maxMemory,
  });

  return `scrypt$${cost}$${salt.toString("base64url")}$${Buffer.from(key).toString("base64url")}`;
}

export async function verifyPassword(password, encodedHash) {
  if (typeof password !== "string" || typeof encodedHash !== "string") {
    return false;
  }

  const [algorithm, encodedCost, encodedSalt, encodedKey, ...rest] =
    encodedHash.split("$");
  const parsedCost = Number(encodedCost);
  if (
    rest.length ||
    algorithm !== "scrypt" ||
    parsedCost !== cost ||
    !encodedSalt ||
    !encodedKey
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedKey, "base64url");
    if (salt.length !== 16 || expected.length !== keyLength) return false;

    const actual = Buffer.from(
      await scrypt(password, salt, keyLength, {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: maxMemory,
      })
    );
    return timingSafeEqual(actual, expected);
  } catch (error) {
    if (error?.code !== "ERR_CRYPTO_INVALID_SCRYPT_PARAMS") {
      throw error;
    }
    return false;
  }
}
