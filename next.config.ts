import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // The preview gateway forwards requests under a different host than the
  // browser origin. Without these, every Server Action POST is rejected with
  // "Invalid Server Actions request" before it reaches our code.
  allowedDevOrigins: [
    "*.space-z.ai",
    "preview-chat-981f4974-6aa9-4f2e-b87a-a68bd11f105c.space-z.ai",
  ],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "*.space-z.ai",
        "preview-chat-981f4974-6aa9-4f2e-b87a-a68bd11f105c.space-z.ai",
        "*.fcapp.run",
        "ws-efcec-baffeb-uewmogidex.cn-hongkong-vpc.fcapp.run",
        "localhost:3000",
      ],
    },
  },
};

export default nextConfig;
