const storagePrefix = 'artype.balance.pending.v1:';
const unavailableMessage = 'Журнал финансовых операций недоступен. Разрешите хранилище этой вкладки и обновите страницу; новые операции пока не отправляются.';

function validRequest(request) {
  return request && ['credit', 'set'].includes(request.operation) &&
    Number.isSafeInteger(request.amount_cents) &&
    request.amount_cents >= (request.operation === 'credit' ? 1 : 0) &&
    request.amount_cents <= 9000000000000 &&
    typeof request.reason === 'string' && request.reason.length >= 3 &&
    request.reason.length <= 500 &&
    Object.keys(request).sort().join(',') === 'amount_cents,operation,reason';
}

function fingerprint(request) {
  return JSON.stringify([request.operation, request.amount_cents, request.reason]);
}

// sessionStorage survives a reload of this tab. Records stay scoped to their
// account after logout; restoring them never sends a financial request.
export function createBalanceJournal({state, storage}) {
  const storageKey = userId => storagePrefix + encodeURIComponent(userId);

  function storageFailure(cause) {
    state.balanceJournalError = unavailableMessage;
    return new Error(unavailableMessage, {cause});
  }

  function read(userId) {
    try {
      const raw = storage.getItem(storageKey(userId));
      if (raw === null) return new Map();
      const data = JSON.parse(raw);
      if (data.version !== 1 || data.userId !== userId || !Array.isArray(data.operations)) {
        throw new Error('Invalid financial journal');
      }
      const operations = new Map();
      for (const operation of data.operations) {
        if (!operation || typeof operation.tenant !== 'string' || !operation.tenant ||
            typeof operation.key !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operation.key) ||
            !validRequest(operation.request) || operations.has(operation.tenant)) {
          throw new Error('Invalid financial operation');
        }
        operations.set(operation.tenant, {
          userId, tenant: operation.tenant, key: operation.key,
          request: operation.request, fingerprint: fingerprint(operation.request),
        });
      }
      return operations;
    } catch (error) {
      throw storageFailure(error);
    }
  }

  function write(userId, operations) {
    const data = JSON.stringify({
      version: 1, userId,
      operations: [...operations.values()].map(({tenant, key, request}) => ({tenant, key, request})),
    });
    try {
      storage.setItem(storageKey(userId), data);
      if (storage.getItem(storageKey(userId)) !== data) throw new Error('Financial journal was not stored');
      state.balanceJournalError = '';
    } catch (error) {
      throw storageFailure(error);
    }
  }

  function restore() {
    state.pendingBalances.clear();
    state.balanceJournalError = '';
    if (!state.me?.operator) return;
    try {
      state.pendingBalances = read(state.me.user.id);
    } catch {
      // A storage problem blocks finance, not the rest of the cabinet.
      // The balance form displays balanceJournalError.
    }
  }

  function prepare(tenant, request, crypto) {
    if (!state.me?.operator) throw new Error('Финансовые операции доступны администратору платформы.');
    if (!validRequest(request)) throw new Error('Проверьте сумму и основание финансовой операции.');
    const userId = state.me.user.id;
    const operations = read(userId);
    let operation = operations.get(tenant);
    const firstAttempt = !operation;
    if (operation && operation.fingerprint !== fingerprint(request)) {
      throw new Error('Сначала подтвердите результат предыдущей операции: повторите её с прежними суммой и основанием. Новая операция пока не отправлена.');
    }
    if (!operation) {
      operation = {userId, tenant, key: crypto.randomUUID(), request: {...request}, fingerprint: fingerprint(request)};
      operations.set(tenant, operation);
    }
    // Even retries verify storage before sending, so an unavailable journal
    // cannot silently turn a reload into a fresh credit with a different key.
    write(userId, operations);
    state.pendingBalances = operations;
    return {...operation, firstAttempt};
  }

  function complete(operation) {
    const operations = read(operation.userId);
    if (operations.get(operation.tenant)?.key !== operation.key) return;
    operations.delete(operation.tenant);
    write(operation.userId, operations);
    if (state.me?.user.id === operation.userId) state.pendingBalances = operations;
  }

  return {restore, prepare, complete};
}
