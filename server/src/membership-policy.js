// Queries using this predicate consistently alias memberships as `m`.
export const seatedMembership = "(m.status='active' OR (m.status='invited' AND m.expires_at>clock_timestamp()))";

export function membershipEnabled(member, now = new Date()) {
  return !!member && (
    member.status === 'active' ||
    (member.status === 'invited' && new Date(member.expires_at) > now)
  );
}
