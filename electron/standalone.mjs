import { loadState } from "./server/store.mjs";
import { createServer } from "./server/http.mjs";

const port = Number(process.env.PORT || 4173);

await loadState();
const { url, server } = await createServer({ port, host: "127.0.0.1" });

console.log(`Pi Flow 已启动：${url}`);
console.log("（纯 Node 调试模式，用浏览器打开上面的地址）");

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
