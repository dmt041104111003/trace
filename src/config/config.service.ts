import type { Network } from "@meshsdk/core";
import type { Plutus } from "../types";
import { readFileSync } from "fs";
import { join } from "path";
import { Injectable } from "@nestjs/common";

export const VALIDATOR_TITLE = {
  mint: "mint.mint.mint",
  store: "store.store.spend",
} as const;

export const CIP68_PREFIX = {
  REFERENCE_100: "000643b0",
  USER_222: "000de140",
} as const;

@Injectable()
export class ConfigService {
  private _plutus: Plutus | null = null;

  get blockfrostApiKey(): string {
    return process.env.BLOCKFROST_API_KEY ?? "";
  }

  get koiosToken(): string {
    return process.env.KOIOS_TOKEN ?? "";
  }

  get appNetwork(): Network {
    const raw = (
      process.env.NEXT_PUBLIC_APP_NETWORK ?? "preprod"
    ).toLowerCase() as Network;
    return raw === "mainnet" ? "mainnet" : "preprod";
  }

  get appNetworkId(): number {
    return this.appNetwork === "mainnet" ? 1 : 0;
  }

  get ipfsEndpoint(): string {
    return process.env.IPFS_ENDPOINT ?? "";
  }

  get ipfsGateway(): string {
    return process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://ipfs.io/";
  }

  get mintReferenceScriptHash(): string {
    return process.env.MINT_REFERENCE_SCRIPT_HASH ?? "";
  }

  get storeReferenceScriptHash(): string {
    return process.env.STORE_REFERENCE_SCRIPT_HASH ?? "";
  }

  get validatorTitle(): typeof VALIDATOR_TITLE {
    return VALIDATOR_TITLE;
  }

  get cip68Prefix(): typeof CIP68_PREFIX {
    return CIP68_PREFIX;
  }

  getPlutus(): Plutus {
    if (!this._plutus) {
      const path = join(process.cwd(), "plutus.json");
      const content = readFileSync(path, "utf-8");
      this._plutus = JSON.parse(content) as Plutus;
    }
    return this._plutus;
  }
}
