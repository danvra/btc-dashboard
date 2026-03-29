// @ts-nocheck
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dashboardCacheHandler from "./api/dashboard-cache.js";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "dashboard-api-dev-middleware",
      configureServer(server) {
        async function handleApiRequest(req, res, next, handler) {
          if (req.method !== "GET") {
            next();
            return;
          }

          try {
            const response = res;

            response.status = (code: number) => {
              res.statusCode = code;
              return response;
            };
            response.json = (payload: unknown) => {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify(payload));
              return response;
            };
            response.send = (payload: string) => {
              res.end(payload);
              return response;
            };

            await handler(req, response);
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : "Unable to serve dashboard cache.",
              }),
            );
          }
        }

        server.middlewares.use("/api/dashboard-cache", (req, res, next) =>
          handleApiRequest(req, res, next, dashboardCacheHandler),
        );
      },
    },
  ],
});
