import type { UTxO } from "@meshsdk/core";
import { resolvePaymentKeyHash } from "@meshsdk/core";
import { decodeFirst } from "cbor";
import { CIP68_PREFIX } from "../config/config.service";
import { blockfrostFetcher } from "../cardano/standalone";
import { datumToJson, decodeReceivers, getPkHash } from "../cip68/utils";
import type { MultisigDatum } from "./multisig.types";
import { POLICY_ID_HEX_LENGTH } from "./multisig.types";

export async function parseMultisigDatumFromUtxo(
  utxo: UTxO
): Promise<MultisigDatum> {
  const data = utxo.output.plutusData;

  if (!data) {
    throw new Error("UTxO has no plutusData");
  }

  if (typeof data !== "string") {
    const obj = data as { alternative?: number; fields?: unknown[] };

    if (Array.isArray(obj?.fields)) {
      const fields = obj.fields;

      if (fields.length >= 3) {
        const [owners, threshold, recipient] = fields;

        return {
          ownersPkh: Array.isArray(owners)
            ? owners.map((o: unknown) =>
                typeof o === "string" ? o : String(o)
              )
            : [],
          threshold: Number(threshold ?? 0),
          recipientPkh:
            typeof recipient === "string" ? recipient : String(recipient),
        };
      }
    }
  }

  try {
    const buffer = Buffer.from(data as string, "hex");
    const decoded = await decodeFirst(buffer);

    const value = (decoded as { value?: unknown[] })?.value ?? decoded;
    const raw = Array.isArray(value) ? value : [value];

    const fields =
      raw.length >= 4 && typeof raw[0] === "number"
        ? raw.slice(1)
        : raw.length >= 3
        ? raw
        : raw[0] != null && Array.isArray(raw[0])
        ? raw[0]
        : raw;

    if (!Array.isArray(fields) || fields.length < 3) {
      throw new Error("Invalid datum");
    }

    const toHex = (x: unknown) =>
      Buffer.isBuffer(x) || x instanceof Uint8Array
        ? Buffer.from(x).toString("hex")
        : String(x);

    const ownersRaw = fields[0];

    const ownersPkh = Array.isArray(ownersRaw)
      ? ownersRaw.map((b) => toHex(b))
      : [];

    const result: MultisigDatum = {
      ownersPkh,
      threshold: Number(fields[1]) || 0,
      recipientPkh: toHex(fields[2]),
    };

    return result;
  } catch (e) {
    throw new Error(
      `Unsupported datum format: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }
}

export async function getAllowedPkhsFromRef100ByNftUnit(
  nftUnit222: string
): Promise<string[]> {
  if (
    !nftUnit222 ||
    nftUnit222.length <=
      POLICY_ID_HEX_LENGTH + CIP68_PREFIX.USER_222.length
  ) {
    return [];
  }

  const policyId = nftUnit222.slice(0, POLICY_ID_HEX_LENGTH);
  const rest = nftUnit222.slice(POLICY_ID_HEX_LENGTH);

  if (!rest.startsWith(CIP68_PREFIX.USER_222)) {
    return [];
  }

  const assetNameHex = rest.slice(CIP68_PREFIX.USER_222.length);
  const unit100 = policyId + CIP68_PREFIX.REFERENCE_100 + assetNameHex;

  const txList = await blockfrostFetcher.fetchAssetTransactions(unit100);

  if (!Array.isArray(txList) || txList.length === 0) {
    return [];
  }

  let outputWithUnit: any | undefined;

  for (const tx of [...txList].reverse()) {
    const txHash = (tx as { tx_hash: string }).tx_hash;
    const txUtxos = await blockfrostFetcher.fetchTransactionsUTxO(txHash);

    const outputs = (txUtxos as { outputs?: any[] }).outputs ?? [];

    outputWithUnit = outputs.find((output: any) =>
      output.amount?.some((a: { unit: string }) => a.unit === unit100)
    );

    if (outputWithUnit && outputWithUnit.inline_datum) {
      break;
    }
  }

  if (!outputWithUnit || !outputWithUnit.inline_datum) {
    return [];
  }

  const datum = String(outputWithUnit.inline_datum);

  const meta = (await datumToJson(datum, {
    contain_pk: true,
  })) as Record<string, string>;

  const minterPk = meta._pk ?? (await getPkHash(datum)) ?? "";
  const receivers = decodeReceivers(meta.receivers);

  const allowed = new Set<string>();

  if (minterPk) {
    allowed.add(minterPk.toLowerCase());
  }

  for (const receiver of receivers) {
    const raw = (receiver.pubKeyHash ?? "").trim();

    if (!raw) {
      continue;
    }

    let pkh = raw;

    if (raw.startsWith("addr")) {
      try {
        pkh = resolvePaymentKeyHash(raw);
      } catch {
        pkh = raw;
      }
    }

    if (pkh) {
      allowed.add(pkh.toLowerCase());
    }
  }

  return Array.from(allowed);
}

export async function assertRecipientAllowedByRef100(
  recipientPkh: string,
  nftUnit222: string
): Promise<void> {
  const allowed = await getAllowedPkhsFromRef100ByNftUnit(nftUnit222);

  const recipientLower = recipientPkh.toLowerCase();

  if (allowed.length === 0) {
    throw new Error(
      "Ref100 metadata for this NFT was not found — cannot verify traceability chain."
    );
  }

  if (!allowed.includes(recipientLower)) {
    const defaultEAddress = process.env.E_ADDRESS?.trim() ?? "";

    let defaultEPkh: string | null = null;

    if (defaultEAddress && defaultEAddress.startsWith("addr")) {
      try {
        defaultEPkh = resolvePaymentKeyHash(defaultEAddress);
      } catch {
        defaultEPkh = null;
      }
    }

    throw new Error(
      `Recipient is not in the traceability chain (Ref100.receivers/_pk). ` +
        `recipientLower=${recipientLower}, allowedSample=${allowed
          .slice(0, 5)
          .join(",")}`
    );
  }
}

