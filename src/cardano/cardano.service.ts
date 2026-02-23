import { Injectable } from "@nestjs/common";
import { BlockfrostProvider } from "@meshsdk/core";
import { ConfigService } from "../config/config.service";
import { buildRef100Unit, parseHttpError } from "../common/utils";
import { BlockfrostFetcher } from "./blockfrost.fetcher";

@Injectable()
export class CardanoService {
  private _fetcher: BlockfrostFetcher | null = null;
  private _provider: BlockfrostProvider | null = null;

  constructor(private readonly config: ConfigService) {}

  get blockfrostFetcher(): BlockfrostFetcher {
    if (!this._fetcher) {
      this._fetcher = new BlockfrostFetcher(
        this.config.blockfrostApiKey,
        0,
        {
          buildRef100Unit: (p, a) =>
            buildRef100Unit(p, a, this.config.cip68Prefix),
          parseHttpError,
        }
      );
    }
    return this._fetcher;
  }

  get blockfrostProvider(): BlockfrostProvider {
    if (!this._provider) {
      this._provider = new BlockfrostProvider(this.config.blockfrostApiKey);
    }
    return this._provider;
  }
}
