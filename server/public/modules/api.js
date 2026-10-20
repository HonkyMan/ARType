import {t as tr, getLocale} from './i18n.js';
export class StaleResponse extends Error {
  constructor() {
    super('The response belongs to an expired session.');
    this.name = 'StaleResponse';
  }
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function createApi({state, fetch, onSessionEnd}) {
  async function request(path, method = 'GET', body, csrf = state.me?.csrf) {
    const session = state.sessionVersion;
    let response;
    try {
      response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: {
          'Accept-Language': getLocale(),
          'X-ARType-Language': getLocale(),
          ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
          ...(csrf ? {'X-CSRF-Token': csrf} : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (session !== state.sessionVersion) throw new StaleResponse();
      throw new ApiError(tr('cannot_reach_the_server_check_your_connection_and_try_again'), 0);
    }

    if (session !== state.sessionVersion) throw new StaleResponse();
    // Expiration must take effect before any other pending response is accepted.
    if (response.status === 401) {
      state.endSession();
      onSessionEnd();
      throw new ApiError(tr('your_session_has_expired_sign_in_again'), 401, 'session_expired');
    }

    let data;
    try {
      data = await response.json();
    } catch {
      if (session !== state.sessionVersion) throw new StaleResponse();
      throw new ApiError(tr('the_server_returned_an_invalid_response_refresh_the_page_or_try'), response.status);
    }
    if (session !== state.sessionVersion) throw new StaleResponse();
    if (!response.ok) {
      throw new ApiError(data.error?.message || tr('the_request_could_not_be_completed'), response.status, data.error?.code);
    }
    return data;
  }

  async function logout() {
    const csrf = state.me?.csrf;
    state.endSession();
    onSessionEnd();
    await request('/api/logout', 'POST', {}, csrf);
  }

  return {request, logout};
}
