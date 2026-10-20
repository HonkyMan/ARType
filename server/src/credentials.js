import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encryptCredential(value, master, alias) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(master, 'hex'), iv);
  cipher.setAAD(Buffer.from(alias));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decryptCredential(value, master, alias) {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(master, 'hex'), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(alias));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
