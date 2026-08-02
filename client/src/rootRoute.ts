export type RootSurface = "admin" | "app";

export function rootSurfaceForPath(pathname: string): RootSurface {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/admin" ? "admin" : "app";
}
