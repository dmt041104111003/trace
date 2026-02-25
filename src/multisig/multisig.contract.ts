import type { UTxO } from "@meshsdk/core";
import { MeshTxBuilder, resolvePaymentKeyHash } from "@meshsdk/core";
import { bech32 } from "bech32";
import type { Plutus } from "../types";
import { ConfigService } from "../config/config.service";
import { blockfrostProvider } from "../cardano/standalone";
import type { MultisigContractOpts, MultisigDatum } from "./multisig.types";
import {
  DEFAULT_SPEND_MEM,
  DEFAULT_SPEND_STEPS,
  POLICY_ID_HEX_LENGTH,
  REDEEMER_SPEND_CBOR,
} from "./multisig.types";
import {
  assertRecipientAllowedByRef100,
  parseMultisigDatumFromUtxo,
} from "./multisig.traceability";

const MULTISIG_SPEND_TITLE = "multisig.multisig.spend";
const MULTISIG_SPEND_TITLE_ALT = "multi_sig_wallet.multisig.spend";

function normalizeOutputAmount(
  amount: Array<{ unit: string; quantity: string | number }>
): Array<{ unit: string; quantity: string }> {
  const list = Array.isArray(amount) ? amount : [];
  const lovelace = list.find((a) => a.unit === "lovelace");
  const others = list.filter((a) => a.unit !== "lovelace").map((a) => ({
    unit: a.unit,
    quantity: String(a.quantity ?? "0"),
  }));
  const lovelaceQty = lovelace != null ? String(lovelace.quantity ?? "0") : "0";
  return [{ unit: "lovelace", quantity: lovelaceQty }, ...others];
}

export class MultisigContract {
  private plutus: Plutus;
  private appNetwork: "mainnet" | "preprod" | "preview";
  private validatorTitle: string;
  private _scriptCbor: string | null = null;
  private _scriptAddress: string | null = null;

  constructor(opts: MultisigContractOpts = {}) {
    const config = new ConfigService();
    this.plutus = opts.plutus ?? config.getPlutus();
    this.validatorTitle = opts.validatorTitle ?? MULTISIG_SPEND_TITLE;
    const raw = (process.env.NEXT_PUBLIC_APP_NETWORK ?? "preprod").toLowerCase();
    this.appNetwork =
      opts.appNetwork ?? (raw === "mainnet" ? "mainnet" : "preprod");
  }

  private getValidator() {
    let v = this.plutus.validators.find((x) => x.title === this.validatorTitle);
    if (!v) v = this.plutus.validators.find((x) => x.title === MULTISIG_SPEND_TITLE);
    if (!v) v = this.plutus.validators.find((x) => x.title === MULTISIG_SPEND_TITLE_ALT);
    if (!v) {
      throw new Error(
        `Validator ${this.validatorTitle} (or ${MULTISIG_SPEND_TITLE} / ${MULTISIG_SPEND_TITLE_ALT}) not found in plutus.json`
      );
    }
    return v;
  }

  getScriptCbor(): string {
    if (this._scriptCbor) return this._scriptCbor;
    const v = this.getValidator();
    const code = v.compiledCode;
    const byteLength = code.length / 2;
    this._scriptCbor = "59" + byteLength.toString(16).padStart(4, "0") + code;
    return this._scriptCbor;
  }

  getScriptAddress(): string {
    if (this._scriptAddress) return this._scriptAddress;
    const v = this.getValidator();
    const scriptHashHex = v.hash;
    const hashBytes = Buffer.from(scriptHashHex, "hex");
    const networkId = this.appNetwork === "mainnet" ? 1 : 0;
    const headerByte = networkId === 1 ? 0x71 : 0x70;
    const addrBytes = Buffer.concat([Buffer.from([headerByte]), hashBytes]);
    const words = bech32.toWords(addrBytes as Uint8Array);
    const hrp = networkId === 1 ? "addr" : "addr_test";
    this._scriptAddress = bech32.encode(hrp, words, 1000);
    return this._scriptAddress;
  }

  buildDatum(d: MultisigDatum): { alternative: number; fields: [string[], number, string] } {
    return {
      alternative: 0,
      fields: [d.ownersPkh, d.threshold, d.recipientPkh],
    };
  }

  async buildLockTx(params: {
    scriptAddress: string;
    ownersPkh: string[];
    threshold: number;
    recipientPkh: string;
    assets: { unit: string; quantity: string }[];
    changeAddress: string;
    utxos: UTxO[];
  }): Promise<string> {
    const {
      scriptAddress,
      ownersPkh,
      threshold,
      recipientPkh,
      assets,
      changeAddress,
      utxos,
    } = params;

    const config = new ConfigService();
    const prefix222 = config.cip68Prefix.USER_222;
    const nft222 = assets.find((a) => {
      if (a.unit === "lovelace") return false;
      if (a.unit.length <= POLICY_ID_HEX_LENGTH + prefix222.length) return false;
      const labelPart = a.unit.slice(
        POLICY_ID_HEX_LENGTH,
        POLICY_ID_HEX_LENGTH + prefix222.length
      );
      return labelPart === prefix222;
    });
    if (nft222) {
      await assertRecipientAllowedByRef100(recipientPkh, nft222.unit);
    }

    const datum = this.buildDatum({
      ownersPkh,
      threshold,
      recipientPkh,
    });
    const walletOnlyUtxos = utxos.filter(
      (u) => u.output.address === changeAddress
    );
    const txBuilder = new MeshTxBuilder({
      fetcher: blockfrostProvider,
      submitter: blockfrostProvider,
    });
    txBuilder.setNetwork(this.appNetwork);

    const unsignedTx = await txBuilder
      .txOut(scriptAddress, assets)
      .txOutInlineDatumValue(datum)
      .changeAddress(changeAddress)
      .selectUtxosFrom(
        walletOnlyUtxos.length > 0 ? walletOnlyUtxos : utxos
      )
      .complete();

    return unsignedTx;
  }

  async buildUnlockTx(params: {
    scriptUtxo: UTxO;
    outputAddress: string;
    signingOwnersPkh: string[];
    threshold: number;
    collateral: UTxO;
    changeAddress: string;
    utxos: UTxO[];
  }): Promise<string> {
    const {
      scriptUtxo,
      outputAddress,
      signingOwnersPkh,
      threshold,
      collateral,
      changeAddress,
      utxos,
    } = params;

    if (signingOwnersPkh.length < threshold) {
      throw new Error(
        `signingOwnersPkh.length (${signingOwnersPkh.length}) < threshold (${threshold})`
      );
    }

    const scriptCbor = this.getScriptCbor();
    const filteredUtxos = utxos.filter(
      (u) =>
        !(
          u.input.txHash === scriptUtxo.input.txHash &&
          u.input.outputIndex === scriptUtxo.input.outputIndex
        )
    );
    const walletOnlyUtxos = filteredUtxos.filter(
      (u) => u.output.address === changeAddress
    );

    const protocolParams = await blockfrostProvider.fetchProtocolParameters();
    const txBuilder = new MeshTxBuilder({
      fetcher: blockfrostProvider,
      submitter: blockfrostProvider,
      params: protocolParams,
    });
    txBuilder.setNetwork(this.appNetwork);

    const hasInlineDatum = !!scriptUtxo.output.plutusData;
    txBuilder
      .spendingPlutusScriptV3()
      .txIn(
        scriptUtxo.input.txHash,
        scriptUtxo.input.outputIndex,
        scriptUtxo.output.amount,
        scriptUtxo.output.address
      )
      .txInScript(scriptCbor);

    if (hasInlineDatum) {
      txBuilder.txInInlineDatumPresent();
    } else if (scriptUtxo.output.plutusData) {
      txBuilder.txInDatumValue(scriptUtxo.output.plutusData, "CBOR");
    }

    txBuilder.txInRedeemerValue(REDEEMER_SPEND_CBOR, "CBOR", {
      mem: DEFAULT_SPEND_MEM,
      steps: DEFAULT_SPEND_STEPS,
    });

    for (const pkh of signingOwnersPkh) {
      if (pkh.length === 56) txBuilder.requiredSignerHash(pkh);
    }

    const outputAmount = normalizeOutputAmount(scriptUtxo.output.amount);
    txBuilder.txOut(outputAddress, outputAmount);
    txBuilder.txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    );

    const unsignedTx = await txBuilder
      .changeAddress(changeAddress)
      .selectUtxosFrom(walletOnlyUtxos.length > 0 ? walletOnlyUtxos : filteredUtxos)
      .complete();

    return unsignedTx;
  }

  async parseDatumFromUtxo(utxo: UTxO): Promise<MultisigDatum> {
    return parseMultisigDatumFromUtxo(utxo);
  }
}
