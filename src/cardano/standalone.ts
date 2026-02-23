import { BlockfrostProvider } from "@meshsdk/core";
import { ConfigService } from "../config/config.service";
import { buildRef100Unit, parseHttpError } from "../common/utils";
import { BlockfrostFetcher } from "./blockfrost.fetcher";

let _config: ConfigService | null = null;
let _fetcher: BlockfrostFetcher | null = null;
let _provider: BlockfrostProvider | null = null;

function getConfig(): ConfigService {
  if (!_config) _config = new ConfigService();
  return _config;
}

export function getBlockfrostFetcher(): BlockfrostFetcher {
  if (!_fetcher) {
    const config = getConfig();
    _fetcher = new BlockfrostFetcher(config.blockfrostApiKey, 0, {
      buildRef100Unit: (p, a) => buildRef100Unit(p, a, config.cip68Prefix),
      parseHttpError,
    });
  }
  return _fetcher;
}

export function getBlockfrostProvider(): BlockfrostProvider {
  if (!_provider) {
    _provider = new BlockfrostProvider(getConfig().blockfrostApiKey);
  }
  return _provider;
}

export const blockfrostFetcher = getBlockfrostFetcher();
export const blockfrostProvider = getBlockfrostProvider();
