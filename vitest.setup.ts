// Vitest runs in Node; @supabase/supabase-js expects WebSocket on import in some paths.
if (typeof globalThis.WebSocket === 'undefined') {
  // Minimal stub: enough for module import; tests that need realtime should mock the client.
  globalThis.WebSocket = class WebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 3;
    constructor(_url) {}
    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  };
}
