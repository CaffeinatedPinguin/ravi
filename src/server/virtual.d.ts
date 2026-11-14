/** Provided by the `embed-ui-assets` plugin in `vite.server.config.ts`. */
declare module 'virtual:ui-assets' {
  const assets: Record<string, { type: string; gzipBase64: string }>;
  export default assets;
}
