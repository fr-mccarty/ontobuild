/**
 * The fixed local user. OntoKit Full is single-user and has no authentication:
 * every request acts as this user, who owns every project.
 */
export interface LocalUser {
  id: string;
  name: string;
  email: string;
}

export const LOCAL_USER: LocalUser = {
  id: "local-user",
  name: "Local User",
  email: "local@localhost",
};

/** Role the local user has in every project. */
export const LOCAL_ROLE = "owner" as const;

/** Return the current user (always the local user). */
export function currentUser(): LocalUser {
  return LOCAL_USER;
}

/** `{id, name, email}` summary, as used in ProjectOwner / MemberUser / author fields. */
export function userSummary() {
  return { id: LOCAL_USER.id, name: LOCAL_USER.name, email: LOCAL_USER.email };
}
