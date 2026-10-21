// Plus languages are inherited at read time, including subscriptions created
// before a policy change. Business keeps its own explicitly configured list.
export async function effectiveLanguages(db, tenant) {
  if (tenant.plan !== 'plus') return tenant.languages;
  return (await db.query("SELECT languages FROM plan_defaults WHERE plan='plus'")).rows[0].languages;
}
