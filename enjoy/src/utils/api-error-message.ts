export type ApiErrorLocale = "en" | "vi";

type ErrorWithResponse = {
  code?: string;
  message?: string;
  status?: number;
  response?: {
    status?: number;
  };
};

type SafeApiError = Error & {
  status?: number;
  originalError?: unknown;
};

const messages: Record<ApiErrorLocale, Record<string, string>> = {
  en: {
    network: "Unable to connect to Enjoy. Check your connection and try again.",
    timeout: "The request took too long. Check your connection and try again.",
    unauthorized: "Your session has expired. Please sign in again.",
    forbidden: "You do not have permission to perform this action.",
    rateLimited: "Too many requests. Please wait a moment and try again.",
    server: "Enjoy is temporarily unavailable. Please try again later.",
    request: "The request could not be completed. Please try again.",
  },
  vi: {
    network: "Không thể kết nối với Enjoy. Hãy kiểm tra mạng rồi thử lại.",
    timeout: "Yêu cầu mất quá nhiều thời gian. Hãy kiểm tra mạng rồi thử lại.",
    unauthorized: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    forbidden: "Bạn không có quyền thực hiện thao tác này.",
    rateLimited: "Có quá nhiều yêu cầu. Vui lòng đợi một lát rồi thử lại.",
    server: "Enjoy đang tạm thời không khả dụng. Vui lòng thử lại sau.",
    request: "Không thể hoàn tất yêu cầu. Vui lòng thử lại.",
  },
};

const normalizeLocale = (locale?: string): ApiErrorLocale =>
  typeof locale === "string" && locale.toLowerCase().startsWith("en")
    ? "en"
    : "vi";

export const getApiErrorStatus = (error: unknown): number | undefined => {
  const candidate = error as ErrorWithResponse | null;
  const status = candidate?.response?.status ?? candidate?.status;
  return typeof status === "number" ? status : undefined;
};

const isTimeoutError = (error: ErrorWithResponse) => {
  const message = error.message?.toLowerCase() || "";
  return (
    error.code === "ECONNABORTED" ||
    error.code === "ETIMEDOUT" ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
};

export const getApiErrorMessage = (
  error: unknown,
  locale?: string
): string => {
  const copy = messages[normalizeLocale(locale)];
  const typedError = error as ErrorWithResponse | null;
  const status = getApiErrorStatus(error);

  if (!status) return isTimeoutError(typedError || {}) ? copy.timeout : copy.network;
  if (status === 408 || isTimeoutError(typedError || {})) return copy.timeout;
  if (status === 401) return copy.unauthorized;
  if (status === 403) return copy.forbidden;
  if (status === 429) return copy.rateLimited;
  if (status >= 500 && status <= 599) return copy.server;
  return copy.request;
};

export const createSafeApiError = (
  error: unknown,
  locale?: string
): SafeApiError => {
  const safeError = new Error(getApiErrorMessage(error, locale), {
    cause: error,
  }) as SafeApiError;
  const status = getApiErrorStatus(error);

  safeError.name = "ApiError";
  if (status !== undefined) safeError.status = status;
  Object.defineProperty(safeError, "originalError", {
    configurable: false,
    enumerable: false,
    value: error,
    writable: false,
  });

  return safeError;
};
