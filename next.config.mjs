/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Each deploy gets its own version, so open windows can tell they are out of date.
  env: { NEXT_PUBLIC_BUILD_ID: process.env.RENDER_GIT_COMMIT || String(Date.now()) },
};
export default nextConfig;
