import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "../config/config.module";
import { CardanoService } from "./cardano.service";

@Global()
@Module({
  imports: [ConfigModule],
  providers: [CardanoService],
  exports: [CardanoService],
})
export class CardanoModule {}
