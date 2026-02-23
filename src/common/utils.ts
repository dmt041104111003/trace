import axios from "axios";

export function buildRef100Unit(
  policyId: string,
  assetName: string,
  prefix: { REFERENCE_100: string }
): string {
  const hexName = Buffer.from(assetName, "utf8").toString("hex");
  return `${policyId}${prefix.REFERENCE_100}${hexName}`;
}

export function parseHttpError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return JSON.stringify(error);
  }
  if (error.response) {
    return JSON.stringify({
      data: error.response.data,
      headers: error.response.headers,
      status: error.response.status,
    });
  }
  if (error.request && !(error.request instanceof XMLHttpRequest)) {
    return JSON.stringify(error.request);
  }
  return JSON.stringify({
    code: error.code,
    message: error.message,
  });
}
