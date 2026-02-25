import { Injectable } from "@nestjs/common";
import { MultisigContract } from "./multisig.contract";

@Injectable()
export class MultisigService {
  private _contract: MultisigContract | null = null;

  getContract(): MultisigContract {
    if (!this._contract) this._contract = new MultisigContract();
    return this._contract;
  }

  getScriptAddress(): string {
    return this.getContract().getScriptAddress();
  }

  getScriptCbor(): string {
    return this.getContract().getScriptCbor();
  }
}
