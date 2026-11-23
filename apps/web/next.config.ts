import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The release build (CodeBuild, Linux) sets NEXT_OUTPUT=standalone to get a self-contained server folder. Local
// builds skip it: standalone copies node_modules with symlinks, which Windows only allows with extra privileges.
const standalone = process.env.NEXT_OUTPUT === "standalone";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(standalone
    ? {
        output: "standalone" as const,
        // pnpm monorepo: trace dependencies from the repository root so the server folder is complete.
        outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
      }
    : {}),
};

export default nextConfig;
