import { createRouter, createWebHistory, type RouterHistory, type RouteLocationNormalized } from "vue-router";
import { clearPending } from "./lib/api";
import { decodeMagnetParam } from "./lib/magnet";
import HomeScreen from "./screens/HomeScreen.vue";
import PlaceholderScreen from "./screens/PlaceholderScreen.vue";
import SearchResultsScreen from "./screens/SearchResultsScreen.vue";
import SettingsScreen from "./screens/SettingsScreen.vue";

// While both apps coexist the new one is served under /next/ (and /settings).
// One build serves both; this is removed at cutover.
export function runtimeBase(pathname: string = window.location.pathname): string {
  return pathname.startsWith("/next/") || pathname === "/next" ? "/next/" : "/";
}

function placeholder(screen: string) {
  return (route: RouteLocationNormalized) => {
    const params: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(route.params)) {
      const text = Array.isArray(value) ? value.join("/") : value;
      params[key] = key === "magnet_link" && text ? decodeMagnetParam(text) : text;
    }
    return { screen, params };
  };
}

export function createAppRouter(history: RouterHistory = createWebHistory(runtimeBase())) {
  const router = createRouter({
    history,
    routes: [
      { path: "/", name: "home", component: HomeScreen },
      { path: "/search/:searchterm?", name: "search", component: SearchResultsScreen },
      { path: "/torrent/:torrent_link/", name: "torrent", component: PlaceholderScreen, props: placeholder("torrent-link-screen") },
      { path: "/magnet/:magnet_link/", name: "filelist", component: PlaceholderScreen, props: placeholder("filelist-screen") },
      { path: "/magnet/:magnet_link/:filename", name: "download", component: PlaceholderScreen, props: placeholder("download-screen") },
      { path: "/settings", name: "settings", component: SettingsScreen },
      // Legacy: anything unknown shows the home screen.
      { path: "/:pathMatch(.*)*", name: "fallback", component: HomeScreen },
    ],
  });
  // Stale requests and timers from the screen we are leaving are dropped.
  router.beforeEach(() => {
    clearPending();
  });
  return router;
}
