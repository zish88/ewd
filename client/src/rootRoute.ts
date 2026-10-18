export type RootSurface = "admin" | "knowledge" | "service" | "parts" | "app";

export function rootSurfaceForPath(pathname: string): RootSurface {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") return "admin";
  if (path === "/knowledge") return "knowledge";
  if (path === "/service") return "service";
  if (path === "/parts") return "parts";
  return "app";
}
