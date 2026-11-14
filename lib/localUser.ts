/**
 * OntoKit Full is a local, single-user app with no authentication.
 *
 * `useSession()` is a drop-in replacement for next-auth's hook: it always reports the
 * fixed local user as signed in. `accessToken` is a placeholder string kept so existing
 * `session?.accessToken` guards keep working; the API client never sends it.
 */
export interface LocalUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface LocalSession {
  user: LocalUser;
  accessToken: string;
  expires: string;
  error?: string;
}

export const LOCAL_USER: LocalUser = {
  id: "local-user",
  name: "Local User",
  email: "local@localhost",
  image: null,
};

export const LOCAL_SESSION: LocalSession = {
  user: LOCAL_USER,
  accessToken: "local",
  expires: "9999-12-31T23:59:59.999Z",
};

export type SessionStatus = "authenticated" | "loading" | "unauthenticated";

const RESULT = {
  data: LOCAL_SESSION,
  status: "authenticated" as SessionStatus,
  update: async () => LOCAL_SESSION,
};

/** Always-signed-in session for the local user. */
export function useSession(): {
  data: LocalSession;
  status: SessionStatus;
  update: () => Promise<LocalSession>;
} {
  return RESULT;
}

/** Server-side equivalent of next-auth's `auth()`. */
export async function getLocalSession(): Promise<LocalSession> {
  return LOCAL_SESSION;
}
