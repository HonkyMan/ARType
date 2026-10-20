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
          ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
          ...(csrf ? {'X-CSRF-Token': csrf} : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (session !== state.sessionVersion) throw new StaleResponse();
      throw new ApiError('Не удалось связаться с сервером. Проверьте соединение и повторите запрос.', 0);
    }

    if (session !== state.sessionVersion) throw new StaleResponse();
    // Expiration must take effect before any other pending response is accepted.
    if (response.status === 401) {
      state.endSession();
      onSessionEnd();
      throw new ApiError('Сессия истекла. Войдите снова.', 401, 'session_expired');
    }

    let data;
    try {
      data = await response.json();
    } catch {
      if (session !== state.sessionVersion) throw new StaleResponse();
      throw new ApiError('Сервер вернул некорректный ответ. Обновите страницу или повторите запрос.', response.status);
    }
    if (session !== state.sessionVersion) throw new StaleResponse();
    if (!response.ok) {
      throw new ApiError(data.error?.message || 'Не удалось выполнить запрос.', response.status, data.error?.code);
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
