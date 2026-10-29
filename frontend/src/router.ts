import { createRouter, createWebHistory, type RouterHistory } from "vue-router";
import { clearPending } from "./lib/api";
import DownloadScreen from "./screens/DownloadScreen.vue";
import FilelistScreen from "./screens/FilelistScreen.vue";
import HomeScreen from "./screens/HomeScreen.vue";
import SearchResultsScreen from "./screens/SearchResultsScreen.vue";
import SettingsScreen from "./screens/SettingsScreen.vue";
import TorrentLinkScreen from "./screens/TorrentLinkScreen.vue";

// While both apps coexist the new one is served under /next/ (and /settings).
// One build serves both; this is removed at cutover.
export function runtimeBase(pathname: string = window.location.pathname): string {
  return pathname.startsWith("/next/") || pathname === "/next" ? "/next/" : "/";
}

export function createAppRouter(history: RouterHistory = createWebHistory(runtimeBase())) {
  const router = createRouter({
    history,
    routes: [
      { path: "/", name: "home", component: HomeScreen },
      { path: "/search/:searchterm?", name: "search", component: SearchResultsScreen },
      { path: "/torrent/:torrent_link/", name: "torrent", component: TorrentLinkScreen },
      { path: "/magnet/:magnet_link/", name: "filelist", component: FilelistScreen },
      { path: "/magnet/:magnet_link/:filename", name: "download", component: DownloadScreen },
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
