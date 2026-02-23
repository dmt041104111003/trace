import {
  stringToHex,
  mConStr0,
  CIP68_100,
  metadataToCip68,
  mConStr1,
  mConStr2,
  deserializeAddress,
} from "@meshsdk/core";
import { isEmpty, isNil } from "lodash";
import type { MeshWallet } from "@meshsdk/core";
import { MeshAdapter, type MeshAdapterDeps } from "./mesh.adapter";
import { ConfigService } from "../config/config.service";
import {
  datumToJson,
  decodeReceivers,
  getPkHash,
  metadataForDatum,
} from "./utils";
import { blockfrostFetcher } from "../cardano/standalone";

const CIP68_222 = (tokenNameHex: string) => `000de140${tokenNameHex}`;

export type Cip68ContractOpts = {
  wallet?: MeshWallet;
  minterMintScriptCbor?: string;
} & MeshAdapterDeps;

export class Cip68Contract extends MeshAdapter {
  constructor(opts: Cip68ContractOpts = {}) {
    super(opts);
  }

  private get appNetwork() {
    return new ConfigService().appNetwork;
  }

  mint = async (
    params: {
      assetName: string;
      metadata: Record<string, string>;
      quantity: string;
      receiver: string;
    }[]
  ) => {
    const { utxos, walletAddress, collateral } = await this.getWalletForTx();
    const unsignedTx = this.meshTxBuilder.mintPlutusScriptV3();
    const txOutReceiverMap = new Map<
      string,
      { unit: string; quantity: string }[]
    >();
    await Promise.all(
      params.map(
        async ({
          assetName,
          metadata,
          quantity = "1",
          receiver = "",
        }) => {
          if (quantity !== "1") {
            throw new Error("CIP-68 label 222 requires quantity = 1");
          }
          const existUtXOwithUnit = await this.getAddressUTXOAsset(
            this.storeAddress!,
            this.policyId! + CIP68_100(stringToHex(assetName))
          );
          if (existUtXOwithUnit?.output?.plutusData) {
            throw new Error(
              `Asset name "${assetName}" already minted. Mỗi QR phải dùng asset name duy nhất (ví dụ thêm suffix: ${assetName}-001, ${assetName}-002).`
            );
          } else {
            const receiverKey = !isEmpty(receiver) ? receiver : walletAddress;
            if (txOutReceiverMap.has(receiverKey)) {
              txOutReceiverMap.get(receiverKey)!.push({
                unit: this.policyId! + CIP68_222(stringToHex(assetName)),
                quantity: quantity,
              });
            } else {
              txOutReceiverMap.set(receiverKey, [
                {
                  unit: this.policyId! + CIP68_222(stringToHex(assetName)),
                  quantity: quantity,
                },
              ]);
            }
            unsignedTx
              .mintPlutusScriptV3()
              .mint(
                quantity,
                this.policyId!,
                CIP68_222(stringToHex(assetName))
              )
              .mintingScript(this.mintScriptCbor!)
              .mintRedeemerValue(mConStr0([]))
              .mintPlutusScriptV3()
              .mint("1", this.policyId!, CIP68_100(stringToHex(assetName)))
              .mintingScript(this.mintScriptCbor!)
              .mintRedeemerValue(mConStr0([]))
              .txOut(this.storeAddress!, [
                {
                  unit: this.policyId! + CIP68_100(stringToHex(assetName)),
                  quantity: "1",
                },
              ])
              .txOutInlineDatumValue(
                metadataToCip68(metadataForDatum(metadata))
              );
          }
        }
      )
    );
    txOutReceiverMap.forEach((assets, receiver) => {
      unsignedTx.txOut(receiver, assets);
    });
    unsignedTx
      .changeAddress(walletAddress)
      .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
      .selectUtxosFrom(utxos, "largestFirst", "7500000", true)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      )
      .setNetwork(this.appNetwork);
    return await unsignedTx.complete();
  };

  burn = async (params: {
    assetName: string;
    quantity: string;
    txHash?: string;
  }[]) => {
    const { utxos, walletAddress, collateral } = await this.getWalletForTx();
    const unsignedTx = this.meshTxBuilder;
    await Promise.all(
      params.map(async ({ assetName, quantity, txHash }) => {
        const q = Number(quantity);
        if (!Number.isFinite(q) || Math.abs(q) !== 1) {
          throw new Error("CIP-68 label 222 burn requires quantity = -1");
        }
        const rftSuffix = CIP68_222(stringToHex(assetName));
        const policyIdToUse =
          (await this.getPolicyIdFromWalletRft(walletAddress, rftSuffix)) ??
          this.policyId!;
        const rftUnit = policyIdToUse + rftSuffix;
        const userUtxos = await this.getAddressUTXOAssets(
          walletAddress,
          rftUnit
        );
        const amount = userUtxos.reduce(
          (sum, u) =>
            sum +
            u.output.amount.reduce(
              (amt, a) =>
                a.unit === rftUnit ? amt + Number(a.quantity) : amt,
              0
            ),
          0
        );
        const ref100Unit =
          policyIdToUse + CIP68_100(stringToHex(assetName));
        const storeUtxo = !isNil(txHash)
          ? await this.getUtxoForTx(this.storeAddress!, txHash!)
          : await this.getUtxoContainingUnit(ref100Unit);
        if (!storeUtxo) throw new Error("Store UTXO not found");

        const datum = storeUtxo.output?.plutusData as string | undefined;
        if (datum) {
          const meta = (await datumToJson(datum, {
            contain_pk: true,
          })) as Record<string, string>;
          const minterPk =
            meta._pk ?? (await getPkHash(datum)) ?? "";
          const walletPk = deserializeAddress(walletAddress).pubKeyHash;
          const receivers = decodeReceivers(meta.receivers);
          const inChain =
            walletPk === minterPk ||
            receivers.some((r) => r.pubKeyHash === walletPk);
          if (!inChain) {
            throw new Error(
              "Ví không trong chuỗi (địa chỉ không có trong metadata.receivers). Burn bị từ chối bởi validator."
            );
          }
        }

        const mintScriptCborToUse =
          policyIdToUse !== this.policyId && this.minterMintScriptCbor
            ? this.minterMintScriptCbor
            : this.mintScriptCbor!;

        const burnQuantity = q > 0 ? -q : q;
        const burnQuantityStr = String(burnQuantity);
        const remainingAmount = amount + burnQuantity;

        unsignedTx.readOnlyTxInReference(
          storeUtxo.input.txHash,
          storeUtxo.input.outputIndex
        );
        unsignedTx
          .mintPlutusScriptV3()
          .mint(
            burnQuantityStr,
            policyIdToUse,
            CIP68_222(stringToHex(assetName))
          )
          .mintRedeemerValue(mConStr1([]))
          .mintingScript(mintScriptCborToUse);

        if (remainingAmount > 0) {
          unsignedTx.txOut(walletAddress, [
            {
              unit: rftUnit,
              quantity: String(remainingAmount),
            },
          ]);
        }
      })
    );
    unsignedTx
      .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      )
      .setNetwork(this.appNetwork);
    return await unsignedTx.complete();
  };

  update = async (
    params: {
      assetName: string;
      metadata: Record<string, string>;
      txHash?: string;
    }[]
  ) => {
    const { utxos, walletAddress, collateral } = await this.getWalletForTx();
    const unsignedTx = this.meshTxBuilder;
    await Promise.all(
      params.map(async ({ assetName, metadata, txHash }) => {
        const storeUtxo = !isNil(txHash)
          ? await this.getUtxoForTx(this.storeAddress!, txHash!)
          : await this.getAddressUTXOAsset(
              this.storeAddress!,
              this.policyId! + CIP68_100(stringToHex(assetName))
            );
        if (!storeUtxo) throw new Error("Store UTXO not found");
        unsignedTx
          .spendingPlutusScriptV3()
          .txIn(storeUtxo.input.txHash, storeUtxo.input.outputIndex)
          .txInInlineDatumPresent()
          .txInRedeemerValue(mConStr0([]))
          .txInScript(this.storeScriptCbor!)
          .txOut(this.storeAddress!, [
            {
              unit: this.policyId! + CIP68_100(stringToHex(assetName)),
              quantity: "1",
            },
          ])
          .txOutInlineDatumValue(metadataToCip68(metadataForDatum(metadata)));
      })
    );
    unsignedTx
      .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      )
      .setNetwork(this.appNetwork);
    return await unsignedTx.complete();
  };

  revoke = async (params: { assetName: string; txHash?: string }[]) => {
    const { utxos, walletAddress, collateral } = await this.getWalletForTx();
    const unsignedTx = this.meshTxBuilder;
    for (const { assetName, txHash } of params) {
      const storeUtxo = !isNil(txHash)
        ? await this.getUtxoForTx(this.storeAddress!, txHash!)
        : await this.getAddressUTXOAsset(
            this.storeAddress!,
            this.policyId! + CIP68_100(stringToHex(assetName))
          );
      if (!storeUtxo)
        throw new Error(`Store UTXO not found for ${assetName}`);
      unsignedTx
        .spendingPlutusScriptV3()
        .txIn(storeUtxo.input.txHash, storeUtxo.input.outputIndex)
        .txInInlineDatumPresent()
        .txInRedeemerValue(mConStr1([]))
        .txInScript(this.storeScriptCbor!)
        .mintPlutusScriptV3()
        .mint("-1", this.policyId!, CIP68_100(stringToHex(assetName)))
        .mintRedeemerValue(mConStr2([]))
        .mintingScript(this.mintScriptCbor!);
    }
    unsignedTx
      .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      )
      .setNetwork(this.appNetwork);
    return await unsignedTx.complete();
  };

  createReferenceScriptMint = async (
    MINT_REFERENCE_SCRIPT_ADDRESS: string
  ) => {
    const { walletAddress, utxos, collateral } =
      await this.getWalletForTx();
    const unsignedTx = this.meshTxBuilder
      .txIn(collateral.input.txHash, collateral.input.outputIndex)
      .txOut(MINT_REFERENCE_SCRIPT_ADDRESS, [
        { unit: "lovelace", quantity: "20000000" },
      ])
      .txOutReferenceScript(this.mintScriptCbor!, "V3")
      .txOutDatumHashValue("")
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      );
    return await unsignedTx.complete();
  };

  createReferenceScriptStore = async (
    STORE_REFERENCE_SCRIPT_ADDRESS: string
  ) => {
    const { walletAddress, utxos, collateral } =
      await this.getWalletForTx();
    const unsignedTx = this.meshTxBuilder
      .txIn(collateral.input.txHash, collateral.input.outputIndex)
      .txOut(STORE_REFERENCE_SCRIPT_ADDRESS, [
        { unit: "lovelace", quantity: "20000000" },
      ])
      .txOutReferenceScript(this.storeScriptCbor!, "V3")
      .txOutDatumHashValue("")
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      );
    return await unsignedTx.complete();
  };

  getRftSupply = async (
    assetName: string,
    policyId?: string
  ): Promise<string> => {
    const policyIdToUse = policyId ?? this.policyId!;
    const rftUnit = policyIdToUse + CIP68_222(stringToHex(assetName));
    try {
      const assetInfo = (await blockfrostFetcher.fetchSpecificAsset(
        rftUnit
      )) as { quantity?: string };
      return assetInfo?.quantity ?? "0";
    } catch {
      return "0";
    }
  };

  getRftBalanceAtAddress = async (
    address: string,
    assetName: string,
    policyId?: string
  ): Promise<number> => {
    const policyIdToUse = policyId ?? this.policyId!;
    const rftUnit = policyIdToUse + CIP68_222(stringToHex(assetName));
    const utxos = await this.getAddressUTXOAssets(address, rftUnit);
    return utxos.reduce(
      (sum, u) =>
        sum +
        u.output.amount.reduce(
          (amt, a) => (a.unit === rftUnit ? amt + Number(a.quantity) : amt),
          0
        ),
      0
    );
  };

  getRftDistribution = async (
    assetName: string,
    inChainAddresses: string[],
    policyId?: string
  ): Promise<{
    inChain: Map<string, number>;
    offChain: Map<string, number>;
    totalInChain: number;
    totalOffChain: number;
    totalSupply: string;
  }> => {
    const policyIdToUse = policyId ?? this.policyId!;
    const rftUnit = policyIdToUse + CIP68_222(stringToHex(assetName));
    const inChainSet = new Set(inChainAddresses.map((a) => a.toLowerCase()));
    const inChainMap = new Map<string, number>();
    const offChainMap = new Map<string, number>();
    const txList = await blockfrostFetcher.fetchAllAssetTransactions(rftUnit);
    const allAddresses = new Set<string>();

    for (const txHash of txList.map((t) => t.tx_hash)) {
      try {
        const tx = await blockfrostFetcher.fetchTransactionsUTxO(txHash);
        for (const output of tx.outputs || []) {
          const hasRft = output.amount?.some(
            (a: { unit: string }) => a.unit === rftUnit
          );
          if (hasRft && output.address) {
            allAddresses.add(output.address);
          }
        }
      } catch {
      }

    }

    for (const address of allAddresses) {
      const balance = await this.getRftBalanceAtAddress(
        address,
        assetName,
        policyIdToUse
      );
      if (balance > 0) {
        if (inChainSet.has(address.toLowerCase())) {
          inChainMap.set(address, balance);
        } else {
          offChainMap.set(address, balance);
        }
      }
    }

    const totalInChain = Array.from(inChainMap.values()).reduce(
      (sum, b) => sum + b,
      0
    );
    const totalOffChain = Array.from(offChainMap.values()).reduce(
      (sum, b) => sum + b,
      0
    );
    const totalSupply = await this.getRftSupply(assetName, policyIdToUse);

    return {
      inChain: inChainMap,
      offChain: offChainMap,
      totalInChain,
      totalOffChain,
      totalSupply,
    };
  };
}
