// Who is signed in and their saved risk limits. Pages read this; the backend
// service is the only writer.

const state = {
  ready: false, // false until the first sign-in check has finished
  user: null, // { id, email } or null
  riskSettings: null, // saved limits, or null when none are saved
  settingsError: null, // why the limits could not be loaded, if they could not
  authNotice: null, // a sign-in problem reported by a confirmation or Google link
};

const listeners = new Set();

export const session = {
  get: () => state,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** `silent` updates the state without re-rendering the page the user is on. */
export function setSession(patch, { silent = false } = {}) {
  Object.assign(state, patch);
  if (!silent) listeners.forEach((fn) => fn(state));
}
