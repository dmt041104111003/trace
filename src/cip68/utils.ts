import { decodeFirst } from "cbor";
import axios from "axios";
import { CIP68_PREFIX } from "../config/config.service";

export function buildRef100Unit(policyId: string, assetName: string): string {
  const hexName = Buffer.from(assetName, "utf8").toString("hex");
  return `${policyId}${CIP68_PREFIX.REFERENCE_100}${hexName}`;
}

function datumValueToStr(value: unknown, asHex = false): string {
  if (value == null) return "";
  const isBytes = Buffer.isBuffer(value) || value instanceof Uint8Array;
  if (isBytes && asHex) {
    return Buffer.from(value).toString("hex");
  }
  if (isBytes) {
    try {
      return Buffer.from(value).toString("utf-8");
    } catch {
      return Buffer.from(value).toString("hex");
    }
  }
  return String(value);
}

export async function datumToJson(
  datum: string,
  option?: { contain_pk?: boolean }
): Promise<unknown> {
  const buffer = Buffer.from(datum, "hex");
  const decoded = await decodeFirst(buffer);
  const decodedValue = decoded?.value ?? decoded;
  const datumMap = Array.isArray(decodedValue) ? decodedValue[0] : decodedValue;
  if (!(datumMap instanceof Map)) {
    throw new Error("Invalid Datum");
  }
  const result: Record<string, string> = {};
  datumMap.forEach((value, key) => {
    const keyStr = typeof key === "string" ? key : datumValueToStr(key);
    if (keyStr === "_pk" && !option?.contain_pk) {
      return;
    }
    const outputAsHex = keyStr === "_pk" || keyStr === "receivers_raw";
    try {
      result[keyStr] = datumValueToStr(value, outputAsHex);
    } catch {
      result[keyStr] = String(value);
    }
  });
  return result;
}

export async function getPkHash(datum: string): Promise<string | null> {
  const buffer = Buffer.from(datum, "hex");
  const decoded = await decodeFirst(buffer);
  const keyValuePairs = decoded.value[0];
  for (const [key, value] of keyValuePairs) {
    const keyStr = key.toString("utf-8");
    if (keyStr === "_pk") {
      return value.toString("hex");
    }
  }
  return null;
}

export function decodeReceivers(
  receiversStr: string | undefined
): { pubKeyHash: string }[] {
  if (!receiversStr || typeof receiversStr !== "string") {
    return [];
  }
  const parts = receiversStr.split(",");
  return parts
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return null;
      const colonIndex = trimmed.indexOf(":");
      const pubKeyHash =
        colonIndex > 0 ? trimmed.slice(0, colonIndex).trim() : trimmed;
      return pubKeyHash ? { pubKeyHash } : null;
    })
    .filter((item): item is { pubKeyHash: string } => item != null);
}

export function ensureReceiversRaw(
  metadata: Record<string, string>
): Record<string, string> {
  const receivers = metadata.receivers;
  if (!receivers || typeof receivers !== "string") {
    return metadata;
  }
  const pubKeyHashList = decodeReceivers(receivers);
  const concatenatedPks = pubKeyHashList.map((item) => item.pubKeyHash).join("");
  return { ...metadata, receivers_raw: concatenatedPks };
}

export function metadataForDatum(
  metadata: Record<string, string>
): Record<string, string> {
  const metaWithRaw = ensureReceiversRaw(metadata);
  if (!metaWithRaw.receivers_raw) {
    return metaWithRaw;
  }
  const receiversRawAsUtf8Hex = Buffer.from(
    metaWithRaw.receivers_raw,
    "utf8"
  ).toString("hex");
  return { ...metaWithRaw, receivers_raw: receiversRawAsUtf8Hex };
}

export function parseHttpErrorCip68(error: unknown): string {
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
