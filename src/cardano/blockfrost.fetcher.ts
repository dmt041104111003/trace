import axios from "axios";
import type { Asset } from "@meshsdk/core";
import { resolveRewardAddress } from "@meshsdk/core";
import type { Transaction, UtXO } from "../types";
import type { AxiosInstance } from "axios";
import type { BlockfrostSupportedNetworks } from "@meshsdk/core";
import { buildRef100Unit, parseHttpError } from "../common/utils";
import { CIP68_PREFIX } from "../config/config.service";

export type BlockfrostFetcherDeps = {
  buildRef100Unit: (policyId: string, assetName: string) => string;
  parseHttpError: (error: unknown) => string;
};

export class BlockfrostFetcher {
  private readonly _axiosInstance: AxiosInstance;
  private readonly _network: BlockfrostSupportedNetworks;
  private readonly _buildRef100Unit: (policyId: string, assetName: string) => string;
  private readonly _parseHttpError: (error: unknown) => string;

  constructor(
    projectIdOrBaseUrl: string,
    version?: number,
    deps?: BlockfrostFetcherDeps
  ) {
    const { buildRef100Unit: br, parseHttpError: pe } = deps ?? {
      buildRef100Unit: (p: string, a: string) =>
        buildRef100Unit(p, a, CIP68_PREFIX),
      parseHttpError,
    };
    this._buildRef100Unit = br;
    this._parseHttpError = pe;

    if (
      typeof projectIdOrBaseUrl === "string" &&
      (projectIdOrBaseUrl.startsWith("http") || projectIdOrBaseUrl.startsWith("/"))
    ) {
      this._axiosInstance = axios.create({ baseURL: projectIdOrBaseUrl });
      this._network = "mainnet";
    } else {
      const projectId = projectIdOrBaseUrl;
      const network = projectId.slice(0, 7);
      this._axiosInstance = axios.create({
        baseURL: `https://cardano-${network}.blockfrost.io/api/v${version ?? 0}`,
        headers: { project_id: projectId },
      });
      this._network = network as BlockfrostSupportedNetworks;
    }
  }

  private async _get<T>(
    path: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    try {
      const config = params ? { params } : undefined;
      const { data, status } = await this._axiosInstance.get<T>(path, config);
      if (status === 200 || status === 202) return data;
      throw this._parseHttpError(data);
    } catch (error) {
      throw this._parseHttpError(error);
    }
  }

  async fetchAddressDetail(address: string) {
    return this._get<unknown>(`/addresses/${address}/total`);
  }

  async fetchSpecificAsset(asset: string) {
    return this._get<unknown>(`/assets/${asset}`);
  }

  async isAssetRevoked(policyId: string, assetName: string): Promise<boolean> {
    const ref100Unit = this._buildRef100Unit(policyId, assetName);
    try {
      const assetInfo = (await this.fetchSpecificAsset(ref100Unit)) as {
        quantity?: string;
      };
      return assetInfo?.quantity === "0";
    } catch {
      return false;
    }
  }

  async fetchAssetTransactions(asset: string) {
    return this._get<unknown>(`/assets/${asset}/transactions?order=desc`);
  }

  async fetchAllAssetTransactions(
    asset: string
  ): Promise<Array<{ tx_hash: string }>> {
    const allTxHashes: Array<{ tx_hash: string }> = [];
    const pageSize = 100;
    let currentPage = 1;
    for (;;) {
      const pageData = await this._get<Array<{ tx_hash: string }>>(
        `/assets/${asset}/transactions`,
        { page: currentPage, count: pageSize, order: "asc" }
      );
      if (!Array.isArray(pageData) || pageData.length === 0) break;
      allTxHashes.push(...pageData);
      if (pageData.length < pageSize) break;
      currentPage += 1;
    }
    return allTxHashes;
  }

  async fetchAssetsByPolicy(
    policyId: string
  ): Promise<Array<{ asset: string; quantity: string }>> {
    const allAssets: Array<{ asset: string; quantity: string }> = [];
    const pageSize = 100;
    let currentPage = 1;
    for (;;) {
      const pageData = await this._get<Array<{ asset: string; quantity: string }>>(
        `/assets/policy/${policyId}`,
        { page: currentPage, count: pageSize, order: "asc" }
      );
      if (!Array.isArray(pageData) || pageData.length === 0) break;
      allAssets.push(...pageData);
      if (pageData.length < pageSize) break;
      currentPage += 1;
    }
    return allAssets;
  }

  async fetchAssetsByAddress(address: string): Promise<Asset[]> {
    const rewardAddress = address.startsWith("addr")
      ? resolveRewardAddress(address)
      : address;
    return this._get<Asset[]>(`/accounts/${rewardAddress}/addresses/assets`);
  }

  async fetchUtxoByAddress(address: string): Promise<Array<UtXO>> {
    const allUtxos: UtXO[] = [];
    const pageSize = 100;
    let currentPage = 1;
    try {
      for (;;) {
        const pageData = await this._get<UtXO[]>(
          `/addresses/${address}/utxos`,
          { page: currentPage, count: pageSize }
        );
        if (!Array.isArray(pageData) || pageData.length === 0) break;
        allUtxos.push(...pageData);
        if (pageData.length < pageSize) break;
        currentPage += 1;
      }
      return allUtxos;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        const baseUrl =
          (this._axiosInstance.defaults.baseURL as string) || "";
        console.error(
          "[Blockfrost 404] GET /addresses/{address}/utxos — address:",
          address.slice(0, 40) + "...",
          "| baseURL:",
          baseUrl
        );
      }
      throw this._parseHttpError(err);
    }
  }

  async fetchTransactionsUTxO(txHash: string): Promise<Transaction> {
    return this._get<Transaction>(`/txs/${txHash}/utxos`);
  }

  async fetchDatum(datum: string) {
    return this._get<unknown>(`/scripts/datum/${datum}`);
  }

  async fetchSpecialTransaction(txHash: string) {
    return this._get<unknown>(`/txs/${txHash}`);
  }

  async fetchAddressUTXOsAsset(address: string, asset: string) {
    return this._get<unknown>(`/addresses/${address}/utxos/${asset}`);
  }

  async fetchSpecialAddress(address: string) {
    return this._get<unknown>(`/addresses/${address}`);
  }

  async fetchAccountAssociate(stakeAddress: string) {
    return this._get<unknown>(`/accounts/${stakeAddress}/addresses`);
  }

  async fetchDetailsAccount(stakeAddress: string) {
    return this._get<unknown>(
      `/accounts/${stakeAddress}/addresses/total`
    );
  }
}
