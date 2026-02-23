import type { UTxO } from "@meshsdk/core";
import { Injectable, BadRequestException } from "@nestjs/common";
import { CardanoService } from "../cardano/cardano.service";
import { CIP68_PREFIX } from "../config/config.service";
import { Cip68Contract } from "../cip68/cip68.contract";

const MIN_COLLATERAL_LOVELACE = 5_000_000;

function createReadOnlyWallet(
  changeAddress: string,
  fetcher: { fetchAddressUTxOs: (address: string) => Promise<UTxO[]> }
): { getChangeAddress: () => Promise<string>; getUtxos: () => Promise<UTxO[]>; getCollateral: () => Promise<UTxO[]> } {
  return {
    getChangeAddress: () => Promise.resolve(changeAddress),
    getUtxos: () => fetcher.fetchAddressUTxOs(changeAddress),
    getCollateral: async () => {
      const utxos = await fetcher.fetchAddressUTxOs(changeAddress);
      const collateral = utxos.find((u) => {
        const lovelace = u.output?.amount?.find((a) => a.unit === "lovelace")?.quantity;
        return Number(lovelace ?? 0) >= MIN_COLLATERAL_LOVELACE;
      });
      if (!collateral) {
        throw new BadRequestException(
          `Không tìm thấy UTXO đủ làm collateral (>= ${MIN_COLLATERAL_LOVELACE} lovelace) tại changeAddress`
        );
      }
      return [collateral];
    },
  };
}

const PREFIX_REF100 = CIP68_PREFIX.REFERENCE_100;
const PREFIX_222 = CIP68_PREFIX.USER_222;

export type PolicyAssetRow = {
  assetName: string;
  ref100Unit: string | null;
  ref100Quantity: string;
  nft222Unit: string | null;
  nft222Quantity: string;
};

export type BuildMetadataInput = {
  pk: string;
  receivers: string;
  receiver_locations: string;
  receiver_coordinates: string;
  minter_location: string;
  minter_coordinates: string;
  name: string;
  image: string;
  properties?: string;
  standard?: string;
};

@Injectable()
export class TraceService {
  constructor(private readonly cardano: CardanoService) {}

  private createContractForAddress(changeAddress: string): Cip68Contract {
    const fetcher = this.cardano.blockfrostProvider;
    const wallet = createReadOnlyWallet(changeAddress, fetcher);
    return new Cip68Contract({ wallet: wallet as unknown as import("@meshsdk/core").MeshWallet });
  }

  private hexToUtf8(hex: string): string {
    try {
      return Buffer.from(hex, "hex").toString("utf8");
    } catch {
      return hex;
    }
  }

  private assetNameFromUnit(
    policyId: string,
    unit: string,
  ): { prefix: string; name: string } | null {
    if (!unit.startsWith(policyId) || unit.length <= policyId.length + 8)
      return null;
    const afterPolicy = unit.slice(policyId.length);
    const prefix = afterPolicy.slice(0, 8);
    const hexName = afterPolicy.slice(8);
    if (!hexName) return { prefix, name: "" };
    return { prefix, name: this.hexToUtf8(hexName) };
  }

  async listAssetsByPolicy(policyId: string): Promise<PolicyAssetRow[]> {
    const fetcher = this.cardano.blockfrostFetcher;
    const raw = await fetcher.fetchAssetsByPolicy(policyId);
    const byLogicalName = new Map<
      string,
      {
        ref100?: { unit: string; quantity: string };
        nft222?: { unit: string; quantity: string };
      }
    >();

    for (const { asset: unit, quantity } of raw) {
      if (!unit.startsWith(policyId)) continue;
      const parsed = this.assetNameFromUnit(policyId, unit);
      if (!parsed) continue;
      const { prefix, name } = parsed;
      if (prefix === PREFIX_REF100) {
        let row = byLogicalName.get(name);
        if (!row) {
          row = {};
          byLogicalName.set(name, row);
        }
        row.ref100 = { unit, quantity };
      } else if (prefix === PREFIX_222) {
        let row = byLogicalName.get(name);
        if (!row) {
          row = {};
          byLogicalName.set(name, row);
        }
        row.nft222 = { unit, quantity };
      }
    }

    const rows: PolicyAssetRow[] = [];
    for (const [assetName, row] of byLogicalName.entries()) {
      rows.push({
        assetName,
        ref100Unit: row.ref100?.unit ?? null,
        ref100Quantity: row.ref100?.quantity ?? "0",
        nft222Unit: row.nft222?.unit ?? null,
        nft222Quantity: row.nft222?.quantity ?? "0",
      });
    }
    rows.sort((a, b) => a.assetName.localeCompare(b.assetName));
    return rows;
  }

  async mint(params: {
    changeAddress: string;
    assetName: string;
    metadata: Record<string, string>;
    receiver?: string;
  }): Promise<{ unsignedTx: string }> {
    const contract = this.createContractForAddress(params.changeAddress);
    const receiver = params.receiver ?? params.changeAddress;
    const unsignedTx = await contract.mint([
      {
        assetName: params.assetName,
        metadata: params.metadata,
        quantity: "1",
        receiver,
      },
    ]);
    return { unsignedTx };
  }

  async update(params: {
    changeAddress: string;
    assetName: string;
    metadata: Record<string, string>;
    txHash?: string;
  }): Promise<{ unsignedTx: string }> {
    const contract = this.createContractForAddress(params.changeAddress);
    const unsignedTx = await contract.update([
      { assetName: params.assetName, metadata: params.metadata, txHash: params.txHash },
    ]);
    return { unsignedTx };
  }

  async burn(params: {
    changeAddress: string;
    assetName: string;
    quantity?: string;
    txHash?: string;
  }): Promise<{ unsignedTx: string }> {
    const contract = this.createContractForAddress(params.changeAddress);
    const unsignedTx = await contract.burn([
      { assetName: params.assetName, quantity: params.quantity ?? "-1", txHash: params.txHash },
    ]);
    return { unsignedTx };
  }

  async revoke(params: {
    changeAddress: string;
    assetName: string;
    txHash?: string;
  }): Promise<{ unsignedTx: string }> {
    const contract = this.createContractForAddress(params.changeAddress);
    const unsignedTx = await contract.revoke([
      { assetName: params.assetName, txHash: params.txHash },
    ]);
    return { unsignedTx };
  }

  /** Gửi signed tx lên chain (client ký xong gửi hex). Không dùng mnemonic. */
  async submitSignedTx(signedTxHex: string): Promise<{ txHash: string }> {
    const txHash = await this.cardano.blockfrostProvider.submitTx(signedTxHex);
    return { txHash };
  }

  buildMetadata(opts: BuildMetadataInput): Record<string, string> {
    let properties: Record<string, unknown> = {};
    if (opts.properties) {
      try {
        properties = JSON.parse(opts.properties) as Record<string, unknown>;
      } catch {
        properties = {};
      }
    }
    if (properties.current_holder_id === undefined) {
      properties.current_holder_id = opts.pk;
    }
    return {
      name: opts.name,
      image: opts.image,
      standard: opts.standard ?? "Traceability-v1",
      properties: JSON.stringify(properties),
      _pk: opts.pk,
      receivers: opts.receivers,
      receiver_locations: opts.receiver_locations,
      receiver_coordinates: opts.receiver_coordinates,
      minter_location: opts.minter_location,
      minter_coordinates: opts.minter_coordinates,
    };
  }
}
