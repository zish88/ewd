export type RootSurface = "admin" | "knowledge" | "app";

export function rootSurfaceForPath(pathname: string): RootSurface {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") return "admin";
  if (path === "/knowledge") return "knowledge";
  return "app";
}
