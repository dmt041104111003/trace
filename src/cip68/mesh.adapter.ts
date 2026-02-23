import {
  applyParamsToScript,
  deserializeAddress,
  MeshTxBuilder,
  MeshWallet,
  resolveScriptHash,
  scriptAddress,
  serializeAddressObj,
  serializePlutusScript,
} from "@meshsdk/core";
import type { UTxO, PlutusScript, IFetcher, IEvaluator } from "@meshsdk/core";
import type { Plutus } from "../types";
import { VALIDATOR_TITLE } from "../config/config.service";
import type { BlockfrostFetcher } from "../cardano/blockfrost.fetcher";
import {
  blockfrostFetcher,
  blockfrostProvider,
} from "../cardano/standalone";
import { ConfigService } from "../config/config.service";

type BlockfrostUtxoOutput = {
  address: string;
  amount: { unit: string; quantity: string }[];
  inline_datum?: string | null;
  data_hash?: string | null;
  reference_script_hash?: string | null;
};

function toUtxo(
  input: { txHash: string; outputIndex: number },
  output: BlockfrostUtxoOutput
): UTxO {
  return {
    input,
    output: {
      address: output.address,
      amount: output.amount,
      plutusData: output.inline_datum ?? undefined,
      dataHash: output.data_hash ?? undefined,
      scriptHash: output.reference_script_hash ?? undefined,
    },
  } as UTxO;
}

export type MeshAdapterDeps = {
  fetcher?: IFetcher;
  provider?: IEvaluator;
  blockfrostFetcher?: BlockfrostFetcher;
  plutus?: Plutus;
  appNetworkId?: number;
  title?: typeof VALIDATOR_TITLE;
};

export class MeshAdapter {
  protected meshTxBuilder!: MeshTxBuilder;
  protected wallet!: MeshWallet;
  protected fetcher!: IFetcher;
  protected blockfrostFetcher!: BlockfrostFetcher;
  protected pubKeyIssuer?: string;
  protected stakeCredentialHash?: string;
  protected mintCompileCode?: string;
  protected storeCompileCode?: string;
  protected storeScriptCbor?: string;
  protected storeScript?: PlutusScript;
  public storeAddress?: string;
  public storeScriptHash?: string;
  protected mintScriptCbor?: string;
  protected mintScript?: PlutusScript;
  public policyId?: string;
  protected minterMintScriptCbor?: string;
  private _initPromise!: Promise<void>;

  constructor(
    opts: {
      wallet?: MeshWallet;
      minterMintScriptCbor?: string;
    } & MeshAdapterDeps = {}
  ) {
    const {
      wallet = null!,
      minterMintScriptCbor,
      fetcher,
      provider,
      blockfrostFetcher: bf,
      plutus,
      appNetworkId,
      title,
    } = opts;
    this.wallet = wallet!;
    this.minterMintScriptCbor = minterMintScriptCbor;
    this.fetcher = fetcher ?? blockfrostProvider;
    this.blockfrostFetcher = bf ?? blockfrostFetcher;
    this.meshTxBuilder = new MeshTxBuilder({
      fetcher: this.fetcher,
      evaluator: provider ?? blockfrostProvider,
    });
    const config = new ConfigService();
    const plutusResolved = plutus ?? config.getPlutus();
    const networkIdResolved = appNetworkId ?? config.appNetworkId;
    const titleResolved = title ?? config.validatorTitle;
    this._initPromise = this.init(plutusResolved, networkIdResolved, titleResolved);
  }

  public async init(
    plutusJson?: Plutus,
    appNetworkId?: number,
    title?: typeof VALIDATOR_TITLE
  ): Promise<void> {
    const config = new ConfigService();
    const plutus = plutusJson ?? config.getPlutus();
    const networkId = appNetworkId ?? config.appNetworkId;
    const t = title ?? config.validatorTitle;
    const changeAddress = await this.wallet.getChangeAddress();
    this.pubKeyIssuer = deserializeAddress(changeAddress).pubKeyHash;
    this.stakeCredentialHash = deserializeAddress(changeAddress).stakeCredentialHash;
    this.mintCompileCode = this.readValidator(plutus, t.mint);
    this.storeCompileCode = this.readValidator(plutus, t.store);
    this.storeScriptCbor = applyParamsToScript(this.storeCompileCode, [
      this.pubKeyIssuer!,
    ]);
    this.storeScript = { code: this.storeScriptCbor, version: "V3" };
    const storeScriptAddress = serializePlutusScript(
      this.storeScript,
      undefined,
      networkId,
      false
    ).address;
    const storeScriptHash = deserializeAddress(storeScriptAddress).scriptHash;
    this.storeAddress = serializeAddressObj(
      scriptAddress(storeScriptHash, this.stakeCredentialHash!, false),
      networkId
    );
    this.storeScriptHash = deserializeAddress(this.storeAddress!).scriptHash;
    this.mintScriptCbor = applyParamsToScript(this.mintCompileCode!, [
      this.storeScriptHash!,
      this.stakeCredentialHash!,
      this.pubKeyIssuer!,
    ]);
    this.mintScript = { code: this.mintScriptCbor, version: "V3" };
    this.policyId = resolveScriptHash(this.mintScriptCbor, "V3");
  }

  public getMintScriptCbor(): string | undefined {
    return this.mintScriptCbor;
  }

  protected getWalletForTx = async (): Promise<{
    utxos: UTxO[];
    collateral: UTxO;
    walletAddress: string;
  }> => {
    await this._initPromise;
    const utxos = await this.wallet.getUtxos();
    const collaterals = await this.wallet.getCollateral();
    const walletAddress = await this.wallet.getChangeAddress();
    if (!utxos || utxos.length === 0) {
      throw new Error("No UTXOs found in getWalletForTx method.");
    }
    if (!collaterals || collaterals.length === 0) {
      throw new Error("No collateral found in getWalletForTx method.");
    }
    if (!walletAddress) {
      throw new Error("No wallet address found in getWalletForTx method.");
    }
    return { utxos, collateral: collaterals[0], walletAddress };
  };

  protected getUtxoForTx = async (address: string, txHash: string) => {
    const utxosAtAddress = await this.fetcher.fetchAddressUTxOs(address);
    const match = utxosAtAddress.find((u) => u.input.txHash === txHash);
    if (!match) {
      throw new Error("No UTXOs found in getUtxoForTx method.");
    }
    return match;
  };

  protected readValidator = function (
    plutusJson: Plutus,
    validatorTitle: string
  ): string {
    const validator = plutusJson.validators.find(
      (v) => v.title === validatorTitle
    );
    if (!validator) {
      throw new Error(`${validatorTitle} validator not found.`);
    }
    return validator.compiledCode;
  };

  protected getPolicyIdFromWalletRft = async (
    walletAddress: string,
    rftSuffix: string
  ): Promise<string | undefined> => {
    await this._initPromise;
    const utxosAtAddress =
      await this.blockfrostFetcher.fetchUtxoByAddress(walletAddress);
    for (const utxo of utxosAtAddress ?? []) {
      for (const amountEntry of utxo.amount ?? []) {
        const unit = amountEntry.unit;
        if (unit?.endsWith(rftSuffix) && unit.length >= 56 + rftSuffix.length) {
          return unit.slice(0, 56);
        }
      }
    }
    return undefined;
  };

  protected getUtxoContainingUnit = async (
    unit: string
  ): Promise<UTxO | undefined> => {
    await this._initPromise;
    const txList = await this.blockfrostFetcher.fetchAssetTransactions(unit);
    if (!Array.isArray(txList) || txList.length === 0) return undefined;
    const firstTxHash = (txList[0] as { tx_hash: string }).tx_hash;
    const txUtxos =
      await this.blockfrostFetcher.fetchTransactionsUTxO(firstTxHash);
    const outputs = txUtxos.outputs ?? [];
    const outputWithUnit = outputs.find((o: { amount?: { unit: string }[] }) =>
      o.amount?.some((a: { unit: string }) => a.unit === unit)
    );
    if (!outputWithUnit || !("output_index" in outputWithUnit))
      return undefined;
    const output = outputWithUnit as {
      output_index: number;
      address: string;
      amount: { unit: string; quantity: string }[];
      inline_datum?: string;
      data_hash?: string;
      reference_script_hash?: string;
    };
    return toUtxo(
      { txHash: firstTxHash, outputIndex: output.output_index },
      output
    );
  };

  protected getAddressUTXOAsset = async (
    address: string,
    unit: string
  ): Promise<UTxO | undefined> => {
    await this._initPromise;
    const utxosAtAddress =
      await this.blockfrostFetcher.fetchUtxoByAddress(address);
    const utxoWithUnit = utxosAtAddress?.find((u) =>
      u.amount?.some((a) => a.unit === unit)
    );
    if (!utxoWithUnit) return undefined;
    return toUtxo(
      { txHash: utxoWithUnit.tx_hash, outputIndex: utxoWithUnit.output_index },
      utxoWithUnit
    );
  };

  protected getAddressUTXOAssets = async (
    address: string,
    unit: string
  ): Promise<UTxO[]> => {
    await this._initPromise;
    const utxosAtAddress =
      await this.blockfrostFetcher.fetchUtxoByAddress(address);
    const utxosWithUnit =
      utxosAtAddress?.filter((u) =>
        u.amount?.some((a) => a.unit === unit)
      ) ?? [];
    return utxosWithUnit.map((utxo) =>
      toUtxo(
        { txHash: utxo.tx_hash, outputIndex: utxo.output_index },
        utxo
      )
    );
  };
}
