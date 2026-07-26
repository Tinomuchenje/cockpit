import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * The server binds to 127.0.0.1, so people naturally reach for that address
   * as well as `localhost`. In development Next blocks cross-origin requests to
   * its dev-only endpoints unless the origin is allow-listed — which rejects the
   * HMR WebSocket upgrade and leaves the page rendered but never hydrated
   * (visible, completely inert). Allow the loopback literals explicitly.
   *
   * Development only; it has no effect on a production build.
   */
  allowedDevOrigins: ["127.0.0.1", "[::1]"],
};

export default nextConfig;
