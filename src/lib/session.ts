import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { getRuntimeEnv, ensureRuntimeEnvLoaded } from "./runtime-env";

export type SessionData = {
  isLoggedIn: boolean;
  username: string;
};

function sessionPassword(): string {
  ensureRuntimeEnvLoaded();
  const secret = getRuntimeEnv("SESSION_SECRET");
  if (secret && secret.length >= 32) return secret;
  // dev fallback — production 请在后台配置 SESSION_SECRET
  return "notionpan-dev-session-secret-change-me-32b";
}

export function getSessionOptions(): SessionOptions {
  return {
    password: sessionPassword(),
    cookieName: "notionpan_session",
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  };
}

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}

export async function requireSession() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    throw new AuthError("未登录");
  }
  return session;
}

export class AuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
