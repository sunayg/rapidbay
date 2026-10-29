import type { Router } from "vue-router";

// Back goes one step in the history; with nowhere to go back to (a page opened
// directly) it replaces the screen with `fallback` instead of leaving the app.
export function navigateBack(router: Router, fallback: string = "/"): void {
  if (window.history.state && window.history.state.back) router.back();
  else void router.replace(fallback);
}
