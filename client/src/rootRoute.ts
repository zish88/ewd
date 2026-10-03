export type RootSurface = "admin" | "knowledge" | "service" | "app";

export function rootSurfaceForPath(pathname: string): RootSurface {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") return "admin";
  if (path === "/knowledge") return "knowledge";
  if (path === "/service") return "service";
  return "app";
}
