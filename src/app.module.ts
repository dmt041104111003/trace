import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { CardanoModule } from "./cardano/cardano.module";
import { Cip68Module } from "./cip68/cip68.module";

@Module({
  imports: [ConfigModule, CardanoModule, Cip68Module],
})
export class AppModule {}
