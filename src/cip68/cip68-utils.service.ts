import { Injectable } from "@nestjs/common";
import {
  buildRef100Unit as buildRef100UnitUtil,
  datumToJson,
  getPkHash as getPkHashUtil,
  decodeReceivers,
  ensureReceiversRaw,
  metadataForDatum as metadataForDatumUtil,
} from "./utils";
import { ConfigService } from "../config/config.service";

@Injectable()
export class Cip68UtilsService {
  constructor(private readonly config: ConfigService) {}

  buildRef100Unit(policyId: string, assetName: string): string {
    return buildRef100UnitUtil(policyId, assetName);
  }

  async datumToJson(
    datum: string,
    option?: { contain_pk?: boolean }
  ): Promise<unknown> {
    return datumToJson(datum, option);
  }

  async getPkHash(datum: string): Promise<string | null> {
    return getPkHashUtil(datum);
  }

  decodeReceivers(receiversStr: string | undefined): { pubKeyHash: string }[] {
    return decodeReceivers(receiversStr);
  }

  ensureReceiversRaw(metadata: Record<string, string>): Record<string, string> {
    return ensureReceiversRaw(metadata);
  }

  metadataForDatum(metadata: Record<string, string>): Record<string, string> {
    return metadataForDatumUtil(metadata);
  }
}
