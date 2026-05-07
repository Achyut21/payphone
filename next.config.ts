import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  /**
   * Permit dev-only HMR + page loads from our ngrok tunnel. Without this,
   * Next 15+ blocks `/_next/webpack-hmr` connections from non-localhost
   * origins, which breaks HMR (and silently breaks the Daily iframe when
   * loaded through the tunnel). The webhook endpoint is server-to-server
   * and unaffected by this setting either way; this is purely about the
   * browser fetching dev assets.
   *
   * If your ngrok URL rotates, update this list. Production builds ignore
   * the field entirely.
   */
  allowedDevOrigins: ['composed-tapeless-equate.ngrok-free.dev'],

  /**
   * NextAuth v5 (still beta) is ESM-only and resolves `next/server`
   * lazily; under Next 16's bundling rules this can produce module-not-
   * found errors in some surfaces. Putting `next-auth` through Next's
   * own transpiler chain avoids it. Documented workaround per Auth.js
   * discussion #10058. Belt-and-suspenders alongside the tsconfig
   * `module: esnext` + `moduleResolution: bundler` switch.
   */
  transpilePackages: ['next-auth'],
};

export default nextConfig;
