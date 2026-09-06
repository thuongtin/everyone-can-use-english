import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-api-errors-"));

try {
  const output = path.join(temp, "api-error-message.mjs");
  await build({
    stdin: {
      contents: `export { createSafeApiError, getApiErrorMessage } from "./src/utils/api-error-message.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const { createSafeApiError, getApiErrorMessage } = await import(
    pathToFileURL(output).href
  );
  const backendError = "\u4e2d\u6587 backend message";
  const responseError = (status) => ({
    message: backendError,
    response: { status },
  });

  assert.equal(
    getApiErrorMessage(responseError(401), "vi"),
    "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
  );
  assert.equal(
    getApiErrorMessage(responseError(403), "vi"),
    "Bạn không có quyền thực hiện thao tác này."
  );
  assert.equal(
    getApiErrorMessage(responseError(429), "vi"),
    "Có quá nhiều yêu cầu. Vui lòng đợi một lát rồi thử lại."
  );
  assert.equal(
    getApiErrorMessage(responseError(500), "vi"),
    "Enjoy đang tạm thời không khả dụng. Vui lòng thử lại sau."
  );
  assert.equal(
    getApiErrorMessage(responseError(503), "en"),
    "Enjoy is temporarily unavailable. Please try again later."
  );
  assert.match(
    getApiErrorMessage({ code: "ECONNABORTED", message: "timeout" }, "vi"),
    /mất quá nhiều thời gian/
  );
  assert.match(
    getApiErrorMessage({ code: "ERR_NETWORK", message: "network failure" }, "vi"),
    /Không thể kết nối/
  );
  assert.match(getApiErrorMessage(responseError(418), "unknown"), /Không thể/);

  const safeError = createSafeApiError(responseError(401), "vi");
  assert.equal(safeError.message, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  assert.equal(safeError.status, 401);
  assert.equal(safeError.cause?.message, backendError);
  assert.equal(safeError.originalError?.response?.status, 401);
  assert.equal("response" in safeError, false);
  assert.doesNotMatch(safeError.message, /backend|\p{Script=Han}/u);

  console.log("PASS: API network, timeout, 401, 403, 429, 5xx, locale fallback, and cause preservation.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
