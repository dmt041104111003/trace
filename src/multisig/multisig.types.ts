import type { Plutus } from "../types";

export type MultisigDatum = {
  ownersPkh: string[];
  threshold: number;
  recipientPkh: string;
};

export type MultisigContractOpts = {
  plutus?: Plutus;
  appNetwork?: "mainnet" | "preprod" | "preview";
  validatorTitle?: string;
};

export const REDEEMER_SPEND_CBOR = "d87980";
export const POLICY_ID_HEX_LENGTH = 56;
export const DEFAULT_SPEND_MEM = 14_000_000;
export const DEFAULT_SPEND_STEPS = 10_000_000_000;

