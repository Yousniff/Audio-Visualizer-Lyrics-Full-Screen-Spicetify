// Shared constants.

export const VERSION = "2026.09.20-settings43";
// The bridge doubles as a lyrics proxy: the lyrics APIs send no CORS
// headers, so the page can't call them directly, but a local process can.
export const PROXY = "http://127.0.0.1:8787";
