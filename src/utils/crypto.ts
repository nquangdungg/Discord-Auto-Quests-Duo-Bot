import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt plaintext → base64(iv + authTag + ciphertext)
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt base64(iv + authTag + ciphertext) → plaintext
 */
export function decrypt(payload: string): string {
  const key = getKey();
  const data = Buffer.from(payload, 'base64');

  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted payload');
  }

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Create a 32-character raw payload for license key
 * Structure: creatorId (truncated) + timestamp_ms + random → pad/truncate to exactly 32 chars
 */
export function createRawKeyPayload(creatorId: string): string {
  const ts = Date.now().toString(); // includes ms
  const randomLen = Math.max(0, 32 - creatorId.length - ts.length);
  const randomPart = crypto.randomBytes(Math.ceil(randomLen / 2))
    .toString('hex')
    .slice(0, randomLen);

  let payload = `${creatorId}${ts}${randomPart}`;

  // Ensure exactly 32 characters
  if (payload.length > 32) {
    payload = payload.slice(0, 32);
  } else if (payload.length < 32) {
    payload = payload.padEnd(32, '0');
  }

  return payload;
}

/**
 * Generate a displayable license key (encrypted version of the 32-char payload)
 */
export function generateLicenseKey(creatorId: string): { raw: string; encrypted: string } {
  const raw = createRawKeyPayload(creatorId);
  const encrypted = encrypt(raw);
  return { raw, encrypted };
}
