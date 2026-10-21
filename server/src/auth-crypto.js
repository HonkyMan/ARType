import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');

export function sameSecret(left, right) {
  return typeof left === 'string' && typeof right === 'string' &&
    timingSafeEqual(Buffer.from(hash(left)), Buffer.from(hash(right)));
}
