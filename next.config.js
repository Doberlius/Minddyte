/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    reactCompiler: true,
  },
  // Without this, Next's dev bundler tries to bundle @electric-sql/pglite's
  // wasm and extension assets (e.g. pg_trgm.tar.gz) itself and mangles their
  // paths, so the server can't even start. This tells Next to leave the
  // package to Node's own resolver instead of bundling it.
  serverExternalPackages: ['@electric-sql/pglite'],
};

module.exports = nextConfig;
