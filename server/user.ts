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

export const LOCAL_ROLE = "owner" as const;

export function currentUser(): LocalUser {
  return LOCAL_USER;
}

export function userSummary() {
  return { id: LOCAL_USER.id, name: LOCAL_USER.name, email: LOCAL_USER.email };
}
