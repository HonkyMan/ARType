// A transport failure does not tell us whether a credit was committed.
// Keep the exact operation and key until it has a definite server outcome.
export async function submitBalance({api, balanceJournal, crypto, tenant, values}) {
  const pending = balanceJournal.prepare(tenant, values, crypto);
  try {
    await api.request(`/api/tenants/${encodeURIComponent(tenant)}/balance`, 'POST', {
      ...pending.request,
      idempotency_key: pending.key,
    });
    return pending;
  } catch (error) {
    // A rejected retry says nothing about whether an earlier attempt committed.
    // Only the first attempt can be ruled out by a definite client-error response.
    if (pending.firstAttempt && error.status >= 400 && error.status < 500 &&
        error.status !== 408 && error.status !== 409 && error.status !== 429) {
      balanceJournal.complete(pending);
    }
    throw error;
  }
}
