export type RootSurface = "admin" | "service" | "parts" | "app";

export function rootSurfaceForPath(pathname: string): RootSurface {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") return "admin";
  if (path === "/service") return "service";
  if (path === "/parts") return "parts";
  // /knowledge retired — old bookmarks fall through to the main app
  return "app";
}
