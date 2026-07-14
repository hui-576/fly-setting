import type { Session } from "electron";

export interface NavigationEvent {
  preventDefault(): void;
}

export interface GuardedWebContents {
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" },
  ): void;
  on(
    event: "will-navigate" | "will-redirect",
    listener: (event: NavigationEvent, url: string) => void,
  ): void;
}

export type LocalPermissionSession = Pick<
  Session,
  "setPermissionCheckHandler" | "setPermissionRequestHandler"
>;

export type AllowedOriginProvider = () => string | null;

export function isAllowedLocalNavigation(value: string, allowedOrigin: string | null): boolean {
  if (!allowedOrigin) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return !url.username && !url.password && url.origin === new URL(allowedOrigin).origin;
}

export function isAllowedPermission(
  permission: string,
  pageUrl: string,
  allowedOrigin: string | null,
): boolean {
  return permission === "geolocation" && isAllowedLocalNavigation(pageUrl, allowedOrigin);
}

export function attachNavigationGuards(
  webContents: GuardedWebContents,
  getAllowedOrigin: AllowedOriginProvider,
): void {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const preventExternalNavigation = (event: NavigationEvent, url: string): void => {
    if (!isAllowedLocalNavigation(url, getAllowedOrigin())) event.preventDefault();
  };
  webContents.on("will-navigate", preventExternalNavigation);
  webContents.on("will-redirect", preventExternalNavigation);
}

export function configureLocalPermissions(
  session: LocalPermissionSession,
  getAllowedOrigin: AllowedOriginProvider,
): void {
  session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isAllowedPermission(permission, webContents.getURL(), getAllowedOrigin()));
  });
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    isAllowedPermission(permission, requestingOrigin, getAllowedOrigin()),
  );
}
