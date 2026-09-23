/**
 * Live mirror (fal realtime try-on over WebRTC). Switched off: the plans no longer
 * offer it and the app hides every way in; the code stays for a later release. The
 * server has its own switch (LIVE_MIRROR_ENABLED env, off by default), so builds
 * that still show the live button cannot start a session either.
 */
export const LIVE_MIRROR_ENABLED: boolean = false;
