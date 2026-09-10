const crypto = require('crypto');

/**
 * Symmetric encryption for secrets that have to live in the database.
 *
 * An SMTP password is not a credential we can hash: the mail server needs the
 * original back on every connection. So it is encrypted with AES-256-GCM,
 * which also authenticates the ciphertext - a tampered row fails to decrypt
 * instead of silently producing a wrong password.
 *
 * Note the trade this makes: moving SMTP config out of the environment does
 * not remove the need for one environment secret, it concentrates it. The key
 * below is the only thing standing between a database dump and the mail
 * password, so it must not be committed or reused elsewhere.
 */
const KEY_LENGTH = 32;

function encryptionKey() {
  const configured = process.env.SETTINGS_ENCRYPTION_KEY;
  if (configured) {
    const key = Buffer.from(configured, 'hex');
    if (key.length !== KEY_LENGTH) throw new Error('SETTINGS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    return key;
  }
  // Fallback so an existing deployment keeps working without new config.
  // Derived, not used directly, so the JWT signing key is never also the
  // encryption key. Rotating JWT_SECRET makes stored passwords unreadable -
  // hence the warning, and hence SETTINGS_ENCRYPTION_KEY being preferred.
  if (!process.env.JWT_SECRET) throw new Error('Set SETTINGS_ENCRYPTION_KEY (or JWT_SECRET) before storing secrets');
  return crypto.scryptSync(process.env.JWT_SECRET, 'yanisa-settings-v1', KEY_LENGTH);
}

/** Returns "v1:<iv>:<authTag>:<ciphertext>", all hex. */
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12); // 96-bit nonce, the size GCM is defined for
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

/** Returns null rather than throwing, so one unreadable row cannot crash a send. */
function decryptSecret(value) {
  try {
    const [version, iv, tag, payload] = String(value || '').split(':');
    if (version !== 'v1' || !iv || !tag || !payload) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(payload, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { encryptSecret, decryptSecret };
