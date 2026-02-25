import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { CardanoModule } from "./cardano/cardano.module";
import { Cip68Module } from "./cip68/cip68.module";
import { TraceModule } from "./trace/trace.module";
import { MultisigModule } from "./multisig/multisig.module";

@Module({
  imports: [ConfigModule, CardanoModule, Cip68Module, TraceModule, MultisigModule],
})
export class AppModule {}
