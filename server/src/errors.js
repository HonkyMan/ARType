import {errorText} from './localization.js';

export class HttpError extends Error {
  constructor(status, code, params = {}) {
    super(errorText(code,'en',params));
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.params = params;
  }
}
export function fail(status, code, params) {
  throw new HttpError(status, code, params);
}
