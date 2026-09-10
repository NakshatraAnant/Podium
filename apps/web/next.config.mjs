/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@podium/ui", "@podium/shared-types"],
  async rewrites() {
    const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";
    return [{ source: "/api/:path*", destination: `${apiBase}/api/:path*` }];
  },
};

export default nextConfig;
